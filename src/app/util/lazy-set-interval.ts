// Avoids the performance issues caused by normal setInterval when the user
// is not at the computer for some time. Uses chained setTimeout instead.
export const lazySetInterval = (
  func: () => void,
  intervalDuration: number,
): (() => void) => {
  let lastTimeoutId: ReturnType<typeof setTimeout>;

  const interval = (): void => {
    lastTimeoutId = setTimeout(interval, intervalDuration);
    func.call(null);
  };

  lastTimeoutId = setTimeout(interval, intervalDuration);

  return () => {
    clearTimeout(lastTimeoutId);
  };
};
