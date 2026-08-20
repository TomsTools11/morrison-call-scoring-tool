const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ score }: { score: number }) {
  const fraction = Math.max(0, Math.min(100, score)) / 100;
  const dash = `${Math.round(CIRCUMFERENCE * fraction)} ${Math.round(CIRCUMFERENCE)}`;
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
      <circle cx="52" cy="52" r={RADIUS} fill="none" stroke="#EFF2F7" strokeWidth="10" />
      <circle
        cx="52"
        cy="52"
        r={RADIUS}
        fill="none"
        stroke="#057BE5"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={dash}
        transform="rotate(-90 52 52)"
      />
    </svg>
  );
}
