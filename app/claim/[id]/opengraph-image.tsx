/**
 * The card a chat draws.
 *
 * A link with no image gets a thin grey line in Telegram; with one it gets a
 * card the size of a message. This is the first thing the person sees, before
 * they have tapped anything, so it says the only things that matter at that
 * moment: who it is from and how much.
 */
import { ImageResponse } from "next/og";
import { getCommitment, getNote, money, cadenceLabel } from "@/lib/iris";

export const runtime = "nodejs";
export const alt = "Money set aside for you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#FBFBFA";
const FG = "#16161A";
const MUTED = "#6B6B76";
const ACCENT = "#4A3AFF";

export default async function Image({ params }: { params: { id: string } }) {
  let from = "";
  let about = "";
  let headline = "Money is waiting for you";
  let cadence = "";

  try {
    const [commitment, note] = await Promise.all([
      getCommitment(BigInt(params.id)),
      getNote(BigInt(params.id)),
    ]);
    from = note.from.trim();
    about = note.about.trim();
    cadence = cadenceLabel(commitment.interval);
    headline = money(commitment.amountPerPayment);
  } catch {
    // A card is never worth failing a page over.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", background: BG, color: FG,
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: 80, fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, color: MUTED, letterSpacing: 2 }}>
          {from ? `FROM ${from.toUpperCase()}` : "SET ASIDE FOR YOU"}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 128, letterSpacing: -4 }}>
            {headline}
            {cadence ? <span style={{ color: ACCENT, marginLeft: 24 }}>{cadence}</span> : null}
          </div>
          {about ? (
            <div style={{ display: "flex", fontSize: 40, color: MUTED, marginTop: 24 }}>
              For {about}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", fontSize: 30, color: MUTED }}>
          The first payment arrives when you open this — no app, no wallet, no account.
        </div>
      </div>
    ),
    size
  );
}
