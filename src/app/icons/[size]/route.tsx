import { ImageResponse } from "next/og";

const SIZES = [192, 512] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;
  const n = parseInt(size, 10);
  if (!SIZES.includes(n as (typeof SIZES)[number])) {
    return new Response("Not Found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
          borderRadius: n >= 256 ? 32 : 16,
          color: "white",
          fontSize: n >= 512 ? 160 : 80,
          fontWeight: "bold",
        }}
      >
        E
      </div>
    ),
    { width: n, height: n }
  );
}
