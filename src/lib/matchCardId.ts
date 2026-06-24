import type { Match, MatchBracket } from "./types";

const BRACKET_TO_TOKEN: Record<MatchBracket, string> = {
  winners: "W",
  losers: "L",
  grand_final: "GF",
  grand_final_reset: "GFR",
};

const TOKEN_TO_BRACKET: Record<string, MatchBracket> = {
  W: "winners",
  L: "losers",
  GF: "grand_final",
  GFR: "grand_final_reset",
};

export function buildMatchCardId(input: {
  bracket: MatchBracket;
  round: number;
  position: number;
}): string {
  const token = BRACKET_TO_TOKEN[input.bracket];
  return `${token}-R${input.round}-M${input.position + 1}`;
}

export function buildMatchCardIdFromMatch(match: Match): string {
  return buildMatchCardId({
    bracket: match.bracket,
    round: match.round,
    position: match.position,
  });
}

export function parseMatchCardId(cardId: string): {
  bracket: MatchBracket;
  round: number;
  position: number;
} | null {
  const normalized = cardId.trim().toUpperCase();
  const m = /^(W|L|GF|GFR)-R(\d+)-M(\d+)$/.exec(normalized);
  if (!m) return null;

  const bracket = TOKEN_TO_BRACKET[m[1]];
  const round = Number(m[2]);
  const matchInRound = Number(m[3]);

  if (!bracket || !Number.isInteger(round) || !Number.isInteger(matchInRound)) return null;
  if (round <= 0 || matchInRound <= 0) return null;

  return {
    bracket,
    round,
    position: matchInRound - 1,
  };
}
