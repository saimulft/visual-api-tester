'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin } from 'lucide-react';
import type { GeoJSONSource, Map as MapLibre, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { Fader } from './fader';
import { fmt, type Scale } from './scale';

/**
 * A point and a radius (board 07, "Map and radius"): MapLibre with OpenFreeMap tiles in a light Dialed
 * style, a pin to drag, a handle on the ring to drag the radius, and the radius fader under it. The
 * OpenStreetMap credit stays visible. Clicking the map moves the pin there.
 */
export type PointRadius = { lat: number; lng: number; radius: number };

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK = { lat: -33.8688, lng: 151.2093 };
const UNIT_METRES: Record<string, number> = { m: 1, km: 1000, mi: 1609.344 };

function circle(lat: number, lng: number, metres: number, points = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Repaints OpenFreeMap's positron in the canvas's map colours. */
function dialedLook(map: MapLibre) {
  for (const layer of map.getStyle().layers ?? []) {
    try {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#eef2f0');
      else if (layer.type === 'fill' && /water/.test(layer.id)) map.setPaintProperty(layer.id, 'fill-color', '#d9e5ea');
      else if (layer.type === 'fill' && /park|wood|grass|landcover/.test(layer.id))
        map.setPaintProperty(layer.id, 'fill-color', '#d6ebe4');
      else if (layer.type === 'line' && /road|highway|street|path/.test(layer.id) && !/casing/.test(layer.id))
        map.setPaintProperty(layer.id, 'line-color', '#ffffff');
    } catch {
      // A layer that won't take the colour keeps positron's.
    }
  }
}

function pinElement() {
  const el = document.createElement('div');
  el.innerHTML =
    '<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 1C6.8 1 1 6.6 1 13.6 1 23 14 35 14 35s13-12 13-21.4C27 6.6 21.2 1 14 1z" fill="#0b1f1c"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg>';
  el.style.cursor = 'grab';
  el.setAttribute('aria-label', 'Point, drag to move');
  return el;
}

function handleElement() {
  const el = document.createElement('div');
  el.style.cssText =
    'width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #0c8577;box-shadow:0 1px 3px rgba(11,31,28,.3);cursor:ew-resize';
  el.setAttribute('aria-label', 'Radius, drag to change');
  return el;
}

export function MapRadius({
  value,
  onChange,
  scale,
  unit = 'km',
  label,
  disabled,
}: {
  value: PointRadius | null;
  onChange: (value: PointRadius) => void;
  /** The radius fader's scale, in `unit`. */
  scale: Scale;
  unit?: string;
  label: string;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const pin = useRef<Marker | null>(null);
  const handle = useRef<Marker | null>(null);
  const latest = useRef({ value, onChange });
  const [failed, setFailed] = useState(false);
  const perUnit = UNIT_METRES[unit] ?? 1000;
  const point = value ?? { ...FALLBACK, radius: Math.min(scale.max, Math.max(scale.min, 5)) };

  useEffect(() => {
    latest.current = { value, onChange };
  });

  // Make the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const start = latest.current.value ?? { ...FALLBACK, radius: 5 };
        const m = new maplibre.Map({
          container: box.current,
          style: STYLE_URL,
          center: [start.lng, start.lat],
          zoom: 10,
          attributionControl: { compact: false },
          interactive: !disabled,
          cooperativeGestures: true,
        });
        map.current = m;
        const place = (lat: number, lng: number, radius: number) => {
          const current = latest.current.value;
          latest.current.onChange({ lat: round(lat), lng: round(lng), radius: current?.radius ?? radius });
        };
        const pinMarker = new maplibre.Marker({ element: pinElement(), draggable: !disabled, anchor: 'bottom' })
          .setLngLat([start.lng, start.lat])
          .addTo(m);
        pin.current = pinMarker;
        pinMarker.on('dragend', () => {
          const at = pinMarker.getLngLat();
          place(at.lat, at.lng, start.radius);
        });
        const handleMarker = new maplibre.Marker({ element: handleElement(), draggable: !disabled })
          .setLngLat([start.lng, start.lat])
          .addTo(m);
        handle.current = handleMarker;
        handleMarker.on('drag', () => {
          const center = pinMarker.getLngLat();
          const at = handleMarker.getLngLat();
          const metres = metresBetween({ lat: center.lat, lng: center.lng }, { lat: at.lat, lng: at.lng });
          const radius = Math.min(scale.max, Math.max(scale.min, Number((metres / perUnit).toFixed(2))));
          const current = latest.current.value ?? { lat: center.lat, lng: center.lng, radius };
          latest.current.onChange({ ...current, lat: round(center.lat), lng: round(center.lng), radius });
        });
        if (!disabled) m.on('click', (e: { lngLat: { lat: number; lng: number } }) => place(e.lngLat.lat, e.lngLat.lng, start.radius));
        m.on('load', () => {
          dialedLook(m);
          const v = latest.current.value ?? start;
          m.addSource('radius', { type: 'geojson', data: circle(v.lat, v.lng, v.radius * perUnit) });
          m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#0c8577', 'fill-opacity': 0.12 } });
          m.addLayer({
            id: 'radius-line',
            type: 'line',
            source: 'radius',
            paint: { 'line-color': '#0c8577', 'line-width': 2, 'line-dasharray': [3, 2.5] },
          });
          fit(m, v);
        });
        m.on('error', () => undefined);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is made once; later values move the pin and ring below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fit = (m: MapLibre, v: PointRadius) => {
    const metres = v.radius * perUnit;
    const dLat = metres / 111_320;
    const dLng = metres / (111_320 * Math.cos((v.lat * Math.PI) / 180));
    m.fitBounds(
      [
        [v.lng - dLng, v.lat - dLat],
        [v.lng + dLng, v.lat + dLat],
      ],
      { padding: 28, duration: 300, maxZoom: 16 },
    );
  };

  // Follow the value: the pin, the ring, the radius handle, and the view when the ring leaves it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const v = point;
    pin.current?.setLngLat([v.lng, v.lat]);
    const metres = v.radius * perUnit;
    const dLng = metres / (111_320 * Math.cos((v.lat * Math.PI) / 180));
    handle.current?.setLngLat([v.lng + dLng, v.lat]);
    const source = m.getSource('radius') as GeoJSONSource | undefined;
    source?.setData(circle(v.lat, v.lng, metres));
    const timer = setTimeout(() => {
      const bounds = m.getBounds();
      if (!bounds.contains([v.lng + dLng, v.lat]) || !bounds.contains([v.lng - dLng, v.lat])) fit(m, v);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.lat, point.lng, point.radius]);

  return (
    <div className="ctl-body">
      <div className="map" style={{ height: 206 }}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} aria-label={`${label}: map`} role="application" />
        {failed && (
          <p className="hint" style={{ position: 'absolute', inset: 'auto 10px 46px' }}>
            The map couldn’t load. The point and radius still work.
          </p>
        )}
        <span className="map-label">
          <MapPin className="i i-sm" aria-hidden="true" />
          <span className="num">
            {value ? `${value.lat.toFixed(3)}, ${value.lng.toFixed(3)}` : 'Click the map to set a point'}
          </span>
        </span>
      </div>
      <Fader
        scale={scale}
        label={`${label}, radius`}
        disabled={disabled}
        value={point.radius}
        onChange={(radius) => onChange({ lat: point.lat, lng: point.lng, radius })}
        top={
          <>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Radius</span>
            <output className="readout">
              {fmt(point.radius)} {unit}
            </output>
          </>
        }
      />
    </div>
  );
}

const round = (n: number) => Number(n.toFixed(5));
