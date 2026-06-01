/**
 * Returns the client-space pointer coordinates for a mouse or touch event,
 * or null if a touch event carries no usable touch point.
 */
export const getPointerPosition = (
  event: MouseEvent | TouchEvent,
): { x: number; y: number } | null => {
  if (!('touches' in event)) {
    return { x: event.clientX, y: event.clientY };
  }

  const touch = event.touches[0] ?? event.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};
