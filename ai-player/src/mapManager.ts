import { type MapData } from "../../common/src/packets/mapPacket";
import { type Vector } from "../../common/src/utils/vector";
import { RectangleHitbox } from "../../common/src/utils/hitbox";
import { Collision, Numeric } from "../../common/src/utils/math";
import { Terrain, River } from "../../common/src/utils/terrain";
import { Vec } from "../../common/src/utils/vector";

export class MapManagerClass {
    private _position = Vec(0, 0);
    private _lastPosition = Vec(0, 0);

    // used for the gas to player line and circle
    private _gasPos = Vec(0, 0);
    private _gasRadius = 0;

    private _width = 0;
    get width(): number { return this._width; }

    private _height = 0;
    get height(): number { return this._height; }

    margins = Vec(0, 0);

    private _terrain!: Terrain;
    get terrain(): Terrain { return this._terrain; }

    private _objects: MapData["objects"] = [];
    private _places: MapData["places"] = [];

    constructor() {
        this._terrain = new Terrain(0, 0, 0, 0, 0, []);
    }

    /**
     * Updates the map data from the server packet
     * This is the main function that needs to be called when receiving a map packet
     */
    updateFromPacket(mapPacket: MapData): void {
        console.log(`Joining game with seed: ${mapPacket.seed}`);

        const width = this._width = mapPacket.width;
        const height = this._height = mapPacket.height;
        this._objects = mapPacket.objects;
        this._places = mapPacket.places;

        const mapBounds = new RectangleHitbox(
            Vec(mapPacket.oceanSize, mapPacket.oceanSize),
            Vec(mapPacket.width - mapPacket.oceanSize, mapPacket.height - mapPacket.oceanSize)
        );

        // Create rivers array with the correct structure
        const rivers: River[] = [];
        rivers.push(...mapPacket.rivers.map(({ width, points, isTrail }) => 
            new River(width, points as Vector[], rivers, mapBounds, isTrail)
        ));

        // Create the terrain with the proper parameters
        this._terrain = new Terrain(
            width,
            height,
            mapPacket.oceanSize,
            mapPacket.beachSize,
            mapPacket.seed,
            rivers
        );

        for (const object of this._objects) {
            if (object.isBuilding) {
                for (const floor of object.definition.floors ?? []) {
                    const hitbox = floor.hitbox.transform(object.position, 1, object.orientation);
                    this._terrain.addFloor(floor.type, hitbox, floor.layer ?? object.layer ?? 0);
                }
            }
        }
    }

    /**
     * Checks if a position is in the ocean
     */
    isInOcean(position: Vector): boolean {
        return !this.terrain.beachHitbox.isPointInside(position);
    }

    /**
     * Gets the distance to shore squared (for performance)
     */
    distanceToShoreSquared(position: Vector): number {
        return Collision.distToPolygonSq(position, this.terrain.beachHitbox.points);
    }

    setPosition(pos: Vector): void {
        this._position = Vec.clone(pos);
        //this.updatePosition();    //TODO
    }
}

export const MapManager = new MapManagerClass();
