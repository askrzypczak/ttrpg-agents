import type { DatabaseSync } from "node:sqlite";
import {
  savedRoomSchema,
  type MapRegistration,
  type MapRepository,
  type SavedRoom,
} from "@ttrpg-agents/engine";

/** One `map_rooms` row, as read. */
interface RoomRow {
  name: string;
  status: string;
  polygons: string;
}

/** One `map_registrations` row. */
interface MapRow {
  item_id: string;
  name: string;
  position_x: number;
  position_y: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  image_offset_x: number;
  image_offset_y: number;
  image_width: number;
  image_height: number;
  image_dpi: number;
  scene_dpi: number;
}

/** Registered maps and the active one, in the `map_registrations` table of the shared database. */
export class SqliteMapRepository implements MapRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  registerMap(registration: MapRegistration): void {
    const { itemId, name, placement: p } = registration;
    this.transaction(() => {
      this.db
        .prepare("UPDATE map_registrations SET active = 0 WHERE active = 1")
        .run();
      this.db
        .prepare(
          `INSERT INTO map_registrations (
             item_id, name, position_x, position_y, rotation, scale_x, scale_y,
             image_offset_x, image_offset_y, image_width, image_height, image_dpi,
             scene_dpi, active
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT (item_id) DO UPDATE SET
             name = excluded.name,
             position_x = excluded.position_x,
             position_y = excluded.position_y,
             rotation = excluded.rotation,
             scale_x = excluded.scale_x,
             scale_y = excluded.scale_y,
             image_offset_x = excluded.image_offset_x,
             image_offset_y = excluded.image_offset_y,
             image_width = excluded.image_width,
             image_height = excluded.image_height,
             image_dpi = excluded.image_dpi,
             scene_dpi = excluded.scene_dpi,
             active = 1`,
        )
        .run(
          itemId,
          name,
          p.position.x,
          p.position.y,
          p.rotation,
          p.scale.x,
          p.scale.y,
          p.imageOffset.x,
          p.imageOffset.y,
          p.imageWidth,
          p.imageHeight,
          p.imageDpi,
          p.sceneDpi,
        );
    });
  }

  getActiveMap(): MapRegistration | undefined {
    const row = this.db
      .prepare(
        `SELECT item_id, name, position_x, position_y, rotation, scale_x, scale_y,
                image_offset_x, image_offset_y, image_width, image_height, image_dpi,
                scene_dpi
           FROM map_registrations WHERE active = 1`,
      )
      .get() as MapRow | undefined;
    if (!row) return undefined;
    return {
      itemId: row.item_id,
      name: row.name,
      placement: {
        position: { x: row.position_x, y: row.position_y },
        rotation: row.rotation,
        scale: { x: row.scale_x, y: row.scale_y },
        imageOffset: { x: row.image_offset_x, y: row.image_offset_y },
        imageWidth: row.image_width,
        imageHeight: row.image_height,
        imageDpi: row.image_dpi,
        sceneDpi: row.scene_dpi,
      },
    };
  }

  getRooms(itemId: string): SavedRoom[] {
    const rows = this.db
      .prepare(
        `SELECT name, status, polygons FROM map_rooms
          WHERE map_item_id = ? ORDER BY position`,
      )
      .all(itemId) as unknown as RoomRow[];
    return rows.map(({ name, status, polygons }) =>
      savedRoomSchema.parse({
        name,
        status,
        polygons: JSON.parse(polygons) as unknown,
      }),
    );
  }

  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM map_rooms WHERE map_item_id = ?")
        .run(itemId);
      const insert = this.db.prepare(
        `INSERT INTO map_rooms (map_item_id, name, status, polygons, position)
         VALUES (?, ?, ?, ?, ?)`,
      );
      rooms.forEach((room, position) => {
        insert.run(
          itemId,
          room.name,
          room.status,
          JSON.stringify(room.polygons),
          position,
        );
      });
    });
  }

  /** Runs fn in one transaction. */
  private transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
