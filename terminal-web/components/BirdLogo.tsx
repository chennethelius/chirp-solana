// A bone-white disc with a bird silhouette inside. Used at small scale in
// the terminal chrome and at hero scale on the onboarding page.
export function BirdLogo({
  size = 64,
  glow = false,
}: {
  size?: number;
  glow?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background:
          "linear-gradient(180deg, #FFFFFF 0%, #E8E8EB 100%)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.6,
        color: "#0A0A0E",
        boxShadow: glow
          ? "0 0 40px rgba(255,180,74,0.45), 0 6px 20px rgba(0,0,0,0.45)"
          : "0 6px 18px rgba(0,0,0,0.4)",
      }}
      aria-hidden
    >
      🐦
    </div>
  );
}
