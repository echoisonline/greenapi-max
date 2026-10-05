const NEAR_BOTTOM_PX = 48;

export function isNearBottom({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;
}
