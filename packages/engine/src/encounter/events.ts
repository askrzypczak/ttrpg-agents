import { z } from "zod";
import { changeOriginSchema } from "./origin.js";
import { monsterInstanceSchema } from "./types.js";

/** Source of truth for `EncounterEvent`; the protocol reuses it as the wire shape. */
export const encounterEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("added"),
    instances: z.array(monsterInstanceSchema),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("removed"),
    id: z.string(),
    origin: changeOriginSchema,
  }),
  z.object({ type: z.literal("cleared"), origin: changeOriginSchema }),
  z.object({
    type: z.literal("hp-changed"),
    id: z.string(),
    currentHp: z.number(),
    maxHp: z.number(),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("instance-changed"),
    id: z.string(),
    changes: z
      .object({
        name: z.string(),
        initiative: z.number().nullable(),
        armorClass: z.number(),
        statsVisible: z.boolean(),
        groupId: z.string(),
      })
      .partial()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: "changes must name at least one field",
      }),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("position-changed"),
    id: z.string(),
    spawnPosition: z.object({ x: z.number(), y: z.number() }).nullable(),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("monster-changed"),
    id: z.string(),
    monsterKey: z.string(),
    displayName: z.string(),
    maxHp: z.number(),
    currentHp: z.number(),
    armorClass: z.number(),
    initiative: z.number().nullable(),
    footprint: z.number().int().min(1),
    origin: changeOriginSchema,
  }),
]);

export type EncounterEvent = z.infer<typeof encounterEventSchema>;
