/**
 * The twelve controls (chat B). ControlView draws any control from the spec; ChannelStrip draws a channel
 * with its CH number. Both take `readOnly` for the Setup page.
 *
 *   <ChannelStrip channel={spec.channels[0]} index={0} values={values} readOnly />
 */
export { ControlView, type ControlContext, type ControlViewProps } from './control-view';
export { ChannelStrip } from './channel-strip';
export { Fader } from './fader';
export { Dial } from './dial';
export { KeywordsInput } from './keywords';
export { PlacesInput } from './places';
export { MapRadius, type PointRadius } from './map-radius';
export { scaleOf, rangeText, fmt, type Scale } from './scale';
