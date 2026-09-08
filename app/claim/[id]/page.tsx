/**
 * The page a link opens — and, before that, the card a chat draws.
 *
 * When someone pastes a claim link into WhatsApp or Telegram, the messenger
 * fetches this page to build a preview. That preview is where the person
 * decides whether to tap, and it is the only place they see anything before
 * they do. So the card is built from the chain: who it is from, how much, how
 * often. The key stays in the fragment, which no crawler ever sees.
 */
import type { Metadata } from "next";
import ClaimClient from "./ClaimClient";
import { getCommitment, getNote, money, cadenceLabel } from "@/lib/iris";

const NOBODY = "0x0000000000000000000000000000000000000000";

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const fallback = {
    title: "Someone set money aside for you",
    description: "Open it to receive the first payment. No app, no wallet, no account.",
  };

  if (!/^\d+$/.test(params.id)) return fallback;

  try {
    const [commitment, note] = await Promise.all([
      getCommitment(BigInt(params.id)),
      getNote(BigInt(params.id)),
    ]);

    // Nothing to advertise once it is spent, and nothing to give away either.
    if (commitment.cancelled || commitment.recipient !== NOBODY) {
      return { title: "This link has been used", description: "Someone has already received this." };
    }

    const who = note.from.trim();
    const amount = money(commitment.amountPerPayment);
    const cadence = cadenceLabel(commitment.interval);

    const title = who
      ? `${who} is setting aside ${amount} for you, ${cadence}`
      : `${amount} is waiting for you, ${cadence}`;

    const description = note.about.trim()
      ? `For ${note.about.trim()}. The first payment arrives when you open this — no app, no wallet, no account.`
      : "The first payment arrives when you open this — no app, no wallet, no account.";

    // Absolute, or the layout's "%s · Iris" template lands in the middle of a
    // chat card. The app's name belongs in og:site_name, which the layout sets.
    return {
      title,
      description,
      openGraph: { title: { absolute: title }, description, type: "website" },
      twitter: { card: "summary_large_image", title: { absolute: title }, description },
    };
  } catch {
    return fallback;
  }
}

export default function ClaimPage({ params }: { params: { id: string } }) {
  return <ClaimClient id={params.id} />;
}
