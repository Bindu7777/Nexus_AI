import { ImageResponse } from "next/og";

// Original social preview, drawn at build time. No external assets or fonts.
export const alt = "Nexus AI: Every bug has a cause. Nexus shows you the proof.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const dot = (x: number, y: number, color: string, r = 10) => (
    <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, background: color }} />
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#060D1F",
          backgroundImage: "radial-gradient(circle at 85% 20%, rgba(59,107,255,0.28), rgba(6,13,31,0) 55%)",
          color: "#EAF1FF",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, border: "3px solid #3B6BFF", display: "flex", alignItems: "center", justifyContent: "center", color: "#22D3EE", fontSize: 26 }}>
            N
          </div>
          Nexus AI
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          <span>Every bug has a cause.</span>
          <span style={{ color: "#BFD4FF" }}>Nexus shows you the proof.</span>
        </div>
        <div style={{ display: "flex", gap: 28, fontSize: 26, color: "#93A4C7" }}>
          <span>Read-only</span>
          <span>·</span>
          <span>Runs in your network</span>
          <span>·</span>
          <span>Every claim cited</span>
        </div>
        <div style={{ position: "absolute", right: 72, top: 150, width: 300, height: 4, background: "linear-gradient(90deg, #3B6BFF, #4F8BFF, #22D3EE)", borderRadius: 2 }} />
        {dot(1128, 152, "#2DD4BF", 12)}
        {dot(828, 152, "#FFB454")}
        {dot(978, 152, "#FFB454")}
      </div>
    ),
    size,
  );
}
