/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `play-pause` command */
  export type PlayPause = ExtensionPreferences & {}
  /** Preferences accessible in the `next-track` command */
  export type NextTrack = ExtensionPreferences & {}
  /** Preferences accessible in the `previous-track` command */
  export type PreviousTrack = ExtensionPreferences & {}
  /** Preferences accessible in the `search-play` command */
  export type SearchPlay = ExtensionPreferences & {}
  /** Preferences accessible in the `add-to-queue` command */
  export type AddToQueue = ExtensionPreferences & {}
  /** Preferences accessible in the `ai-chat` command */
  export type AiChat = ExtensionPreferences & {}
  /** Preferences accessible in the `open-artist` command */
  export type OpenArtist = ExtensionPreferences & {}
  /** Preferences accessible in the `toggle-shuffle` command */
  export type ToggleShuffle = ExtensionPreferences & {}
  /** Preferences accessible in the `volume` command */
  export type Volume = ExtensionPreferences & {}
  /** Preferences accessible in the `clear-queue` command */
  export type ClearQueue = ExtensionPreferences & {}
  /** Preferences accessible in the `open-parachord` command */
  export type OpenParachord = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `play-pause` command */
  export type PlayPause = {}
  /** Arguments passed to the `next-track` command */
  export type NextTrack = {}
  /** Arguments passed to the `previous-track` command */
  export type PreviousTrack = {}
  /** Arguments passed to the `search-play` command */
  export type SearchPlay = {
  /** Artist - Track */
  "query": string
}
  /** Arguments passed to the `add-to-queue` command */
  export type AddToQueue = {
  /** Artist - Track */
  "query": string
}
  /** Arguments passed to the `ai-chat` command */
  export type AiChat = {
  /** Ask the AI DJ... */
  "prompt": string
}
  /** Arguments passed to the `open-artist` command */
  export type OpenArtist = {
  /** Artist name */
  "artist": string
}
  /** Arguments passed to the `toggle-shuffle` command */
  export type ToggleShuffle = {}
  /** Arguments passed to the `volume` command */
  export type Volume = {}
  /** Arguments passed to the `clear-queue` command */
  export type ClearQueue = {}
  /** Arguments passed to the `open-parachord` command */
  export type OpenParachord = {}
}

