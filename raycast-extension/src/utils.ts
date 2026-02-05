import { open, showHUD, showToast, Toast } from "@raycast/api";

/**
 * Build a parachord:// protocol URL
 */
export function buildProtocolUrl(
  command: string,
  segments: string[] = [],
  params: Record<string, string> = {}
): string {
  const path = [command, ...segments.map(encodeURIComponent)].join("/");
  const searchParams = new URLSearchParams(params).toString();
  return `parachord://${path}${searchParams ? `?${searchParams}` : ""}`;
}

/**
 * Open a parachord:// URL and show feedback
 */
export async function openParachord(
  command: string,
  segments: string[] = [],
  params: Record<string, string> = {},
  hudMessage?: string
): Promise<void> {
  const url = buildProtocolUrl(command, segments, params);

  try {
    await open(url);
    if (hudMessage) {
      await showHUD(hudMessage);
    }
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to open Parachord",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Parse "Artist - Track" format into separate parts
 */
export function parseArtistTrack(input: string): { artist: string; title: string } | null {
  // Try "Artist - Track" format first
  const dashMatch = input.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    return {
      artist: dashMatch[1].trim(),
      title: dashMatch[2].trim(),
    };
  }

  // Try "Track by Artist" format
  const byMatch = input.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      artist: byMatch[2].trim(),
      title: byMatch[1].trim(),
    };
  }

  return null;
}
