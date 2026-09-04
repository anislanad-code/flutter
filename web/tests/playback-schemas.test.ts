import { describe, expect, it } from "vitest";

import { battementSchema, lectureSchema } from "@/lib/playback-schemas";

const LECTURE = {
  disponible: true,
  playback_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  playback_url: "https://vz-test.b-cdn.net/bcdn_token=x/playlist.m3u8",
  expires_at: "2026-09-04T17:00:00Z",
  watermark_label: "etudiante · 2233",
  resume_at_s: 0,
  duration_s: 480,
};

describe("lectureSchema", () => {
  it("accepte une lecture https nominale et une indisponible", () => {
    expect(lectureSchema.parse(LECTURE).disponible).toBe(true);
    expect(
      lectureSchema.parse({
        ...LECTURE,
        disponible: false,
        playback_id: null,
        playback_url: null,
        expires_at: null,
      }).playback_url,
    ).toBeNull();
  });

  it("refuse une URL qui n'est pas https", () => {
    expect(lectureSchema.safeParse({ ...LECTURE, playback_url: "http://evil" }).success).toBe(
      false,
    );
    expect(
      lectureSchema.safeParse({ ...LECTURE, playback_url: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("refuse une reprise negative", () => {
    expect(lectureSchema.safeParse({ ...LECTURE, resume_at_s: -1 }).success).toBe(false);
  });
});

describe("battementSchema", () => {
  it("accepte un battement actif", () => {
    expect(
      battementSchema.parse({
        active: true,
        expires_at: "2026-09-04T17:00:00Z",
        resume_at_s: 12,
      }).active,
    ).toBe(true);
  });

  it("refuse un battement incomplet", () => {
    expect(battementSchema.safeParse({ active: true }).success).toBe(false);
  });
});
