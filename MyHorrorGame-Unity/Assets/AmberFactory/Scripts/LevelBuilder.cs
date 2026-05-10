using System.Collections.Generic;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Builds the entire "Old Amber Factory" level procedurally:
    ///  Zone 1 — Administrative offices & security rooms
    ///  Zone 2 — Main production hall (conveyors, presses, gantry crane)
    ///  Zone 3 — Warehouse (tall racks of crates, barrels)
    ///  Zone 4 — Ventilation ducts (crawlspaces)
    ///  Zone 5 — Outdoor yard with the yellow KAMAZ truck
    /// </summary>
    public class LevelBuilder : MonoBehaviour
    {
        // World constants
        const float CELL = NavGrid.CELL;
        const float WALL_H = 3.6f;
        const float DUCT_H = 1.3f;
        const float HALL_H = 12.5f;

        // Data exposed to other systems
        public Vector3 PlayerSpawn;
        public Vector3 MonsterSpawn;
        public NavGrid Nav;

        public List<HidingSpot> HidingSpots = new List<HidingSpot>();
        public List<Throwable> Throwables = new List<Throwable>();
        public List<Pickup> Keys = new List<Pickup>();
        public List<Collider> BlockingColliders = new List<Collider>(); // walls for raycast LOS

        public TruckStarter Truck;
        public SecurityTerminal SecurityTerm;
        public List<CctvCameraSpec> CCTVCameras = new List<CctvCameraSpec>();

        public List<FlickerLight> FlickerLights = new List<FlickerLight>();

        // Grid
        private bool[,] _walk;      // for A*
        private int _gw, _gh;
        private Vector2 _origin;

        // -------------------------------------------------------------

        public void Build()
        {
            ProceduralAudio.EnsureExists();

            // Overall layout: 1 big 100m × 80m factory + 30m outdoor yard.
            // We'll use cells for nav coarsely, with bespoke geometry for each zone.
            _gw = 60; _gh = 80;  // cells
            _walk = new bool[_gh, _gw];
            _origin = new Vector2(-_gw * CELL * 0.5f, -_gh * CELL * 0.5f);

            // Default: all unwalkable, each zone opens up floor
            for (int y = 0; y < _gh; y++)
                for (int x = 0; x < _gw; x++)
                    _walk[y, x] = false;

            // Moon + global light
            BuildSky();

            BuildZone1_Admin();
            BuildZone2_MainHall();
            BuildZone3_Warehouse();
            BuildZone4_Vents();
            BuildZone5_Yard();

            Nav = new NavGrid(_walk, _origin);
        }

        public void ResetPickups()
        {
            foreach (var p in Keys) p.Reset();
            foreach (var t in Throwables) t.Reset();
        }

        // ==========================================================
        //                         SKY / GLOBAL
        // ==========================================================

        private void BuildSky()
        {
            // Moonlight directional
            var go = new GameObject("Moonlight");
            go.transform.SetParent(transform, false);
            var l = go.AddComponent<Light>();
            l.type = LightType.Directional;
            l.color = new Color(0.55f, 0.72f, 0.95f);
            l.intensity = 0.35f;
            l.shadows = LightShadows.Soft;
            l.shadowStrength = 0.7f;
            l.shadowBias = 0.05f;
            go.transform.rotation = Quaternion.Euler(55f, 35f, 0f);

            // Global fill from above
            var fillGO = new GameObject("FillLight");
            fillGO.transform.SetParent(transform, false);
            var fill = fillGO.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = new Color(0.25f, 0.38f, 0.55f);
            fill.intensity = 0.15f;
            fillGO.transform.rotation = Quaternion.Euler(80f, 140f, 0f);

            // Dust particles that follow player — added by player later
        }

        // ==========================================================
        //                    ZONE 1 — ADMIN BLOCK
        //  Corridor along Z=-30..-10, narrow, with 5 rooms off the side:
        //    - Security Room (terminal + lockers)
        //    - Offices (desks, papers, CRT monitors, coat racks)
        //    - Break room
        //  Player spawns in the security room.
        // ==========================================================

        private void BuildZone1_Admin()
        {
            Vector3 origin = new Vector3(-40, 0, -34);
            float blockW = 30, blockD = 24, h = 3.2f;

            // Floor + ceiling + outer walls for the admin block
            BuildRoomBox(origin, blockW, blockD, h, ProceduralTextures.Floor(), ProceduralTextures.Wall(), ProceduralTextures.Ceiling());

            // Mark walkable cells for the block
            MarkRectWalkable(origin + Vector3.right * 0.5f, blockW - 1, blockD - 1);

            // Long corridor runs along the long axis at center. Interior walls:
            // We'll split the block into:
            //   - security room (top-left): 8×8
            //   - office room 1: 8×7
            //   - break room: 7×7
            //   - corridor stripe: 4m wide along the middle X

            // Internal walls (thin)
            float innerY = origin.z + 9f; // corridor south wall
            SpawnWall(new Vector3(origin.x + 0.5f, 0, innerY), new Vector3(blockW - 1, h, 0.25f));
            float innerY2 = origin.z + 13f; // corridor north wall
            SpawnWall(new Vector3(origin.x + 0.5f, 0, innerY2), new Vector3(blockW - 1, h, 0.25f));

            // Cut corridor walkable (4m strip)
            MarkRectWalkable(new Vector3(origin.x + 0.5f, 0, innerY), blockW - 1, innerY2 - innerY);

            // Doorways (cut holes by placing the walls as two shorter pieces)
            // We simulate doorways by removing existing walls and replacing (our wall is already built as a single block;
            // easier: just don't bother — we carve NAV through the walls physically. Instead mark walkable through).

            // Dividers inside upper band (security | office1 | office2)
            float secRight = origin.x + 10f;
            float off2Right = origin.x + 20f;
            SpawnWall(new Vector3(secRight, 0, origin.z + 0.5f), new Vector3(0.25f, h, innerY - origin.z - 0.5f));
            SpawnWall(new Vector3(off2Right, 0, origin.z + 0.5f), new Vector3(0.25f, h, innerY - origin.z - 0.5f));

            // Dividers inside lower band (break | office3)
            float brkRight = origin.x + 12f;
            SpawnWall(new Vector3(brkRight, 0, innerY2 + 0.5f), new Vector3(0.25f, h, origin.z + blockD - innerY2 - 1f));

            // Doors (gaps) — mark nav as walkable across the inner walls at specific X
            MarkWalkable(new Vector3(origin.x + 5f, 0, innerY), 2, 1);     // security → corridor
            MarkWalkable(new Vector3(origin.x + 15f, 0, innerY), 2, 1);    // office1 → corridor
            MarkWalkable(new Vector3(origin.x + 25f, 0, innerY), 2, 1);    // office2 → corridor
            MarkWalkable(new Vector3(origin.x + 7f, 0, innerY2), 2, 1);    // break → corridor
            MarkWalkable(new Vector3(origin.x + 20f, 0, innerY2), 2, 1);   // office3 → corridor

            // Corridor to main hall (east end opens into Zone 2)
            // Floor extension + no wall at X = origin.x + blockW
            float corridorExitX = origin.x + blockW;
            MarkWalkable(new Vector3(corridorExitX - 0.5f, 0, innerY + 1f), 4, 2);

            // --- Security Room contents ---
            var secCenter = new Vector3(origin.x + 5f, 0, origin.z + 5f);
            PlayerSpawn = secCenter + new Vector3(-2, 1.0f, 0);

            // Security desk with 4 monitors — terminal lives here
            var sd = SpawnDesk(secCenter + new Vector3(1.5f, 0, 2f));
            SpawnCRT(sd.transform, new Vector3(-0.8f, 0.84f, 0), new Color(0.08f, 0.22f, 0.25f), isMain: true);
            SpawnCRT(sd.transform, new Vector3(-0.3f, 0.84f, 0), new Color(0.08f, 0.22f, 0.25f));
            SpawnCRT(sd.transform, new Vector3(0.2f, 0.84f, 0), new Color(0.08f, 0.22f, 0.25f));
            SpawnCRT(sd.transform, new Vector3(0.8f, 0.84f, 0), new Color(0.10f, 0.20f, 0.22f));
            // Chair
            SpawnChair(secCenter + new Vector3(1.5f, 0, 3.2f));
            // Locker in corner
            SpawnLocker(secCenter + new Vector3(-2.3f, 0, 2.2f), 90);
            // Coat on hanger
            SpawnCoatRack(secCenter + new Vector3(-2.8f, 0, -2f));
            // Flickering fluorescent light
            SpawnFluorescent(secCenter + new Vector3(0, 3.1f, 0), new Color(0.7f, 0.85f, 0.95f), 1.4f, flicker: true);

            // --- Office Room 1 ---
            var off1 = new Vector3(origin.x + 15f, 0, origin.z + 5f);
            SpawnDesk(off1 + new Vector3(0, 0, 1f));
            SpawnCRT(null, off1 + new Vector3(0, 0.84f, 1f), new Color(0.05f, 0.15f, 0.18f), parentOverride: transform);
            // Flipped chair
            var ch = SpawnChair(off1 + new Vector3(1.5f, 0.2f, 0.8f));
            ch.transform.rotation = Quaternion.Euler(70, 45, 15);
            // Scattered papers
            SpawnPapers(off1 + new Vector3(-1f, 0.01f, -0.5f), 8);
            // Coat rack
            SpawnCoatRack(off1 + new Vector3(-2.8f, 0, 2f));
            // Light
            SpawnFluorescent(off1 + new Vector3(0, 3.1f, 0), new Color(0.75f, 0.88f, 0.95f), 1.5f, flicker: Random.value < 0.5f);

            // --- Office Room 2 (flipped desks, key pickup) ---
            var off2 = new Vector3(origin.x + 25f, 0, origin.z + 5f);
            // Overturned desk
            var od = SpawnDesk(off2 + new Vector3(0, 0.3f, 1f));
            od.transform.rotation = Quaternion.Euler(90, 10, 0);
            od.transform.position += new Vector3(0, 0.5f, 0);
            // Broken CRT on floor
            SpawnCRT(null, off2 + new Vector3(1f, 0.2f, -1f), new Color(0.06f, 0.06f, 0.07f), parentOverride: transform);
            // A KEY on the floor (gold)
            Keys.Add(SpawnKey(off2 + new Vector3(-0.5f, 0.9f, -1f)));
            // Shards / clutter
            SpawnPapers(off2 + new Vector3(0, 0.01f, 0), 12);
            // Bottle to pickup
            Throwables.Add(SpawnThrowable(off2 + new Vector3(-2, 0.1f, -2f), ThrowableType.Bottle));
            SpawnFluorescent(off2 + new Vector3(0, 3.1f, 0), new Color(0.6f, 0.75f, 0.85f), 1.2f, flicker: true);

            // --- Break Room ---
            var brk = new Vector3(origin.x + 6f, 0, origin.z + 17f);
            SpawnDesk(brk + new Vector3(0, 0, 0));
            SpawnChair(brk + new Vector3(0.8f, 0, 1.2f));
            SpawnCoatRack(brk + new Vector3(-2.5f, 0, -1.5f));
            // Mugs on desk (use small cylinders)
            SpawnMug(brk + new Vector3(-0.3f, 0.82f, 0));
            SpawnMug(brk + new Vector3(0.1f, 0.82f, 0));
            // Bottles
            Throwables.Add(SpawnThrowable(brk + new Vector3(-1.5f, 0.1f, 0.4f), ThrowableType.Bottle));
            Throwables.Add(SpawnThrowable(brk + new Vector3(1f, 0.1f, 1.4f), ThrowableType.Can));
            SpawnFluorescent(brk + new Vector3(0, 3.1f, 0), new Color(0.65f, 0.8f, 0.9f), 1.3f, flicker: false);

            // --- Office 3 (storage of scattered throwables) ---
            var off3 = new Vector3(origin.x + 20f, 0, origin.z + 17f);
            Throwables.Add(SpawnThrowable(off3 + new Vector3(0, 0.1f, 0), ThrowableType.Pipe));
            Throwables.Add(SpawnThrowable(off3 + new Vector3(0.5f, 0.1f, 0.3f), ThrowableType.Rebar));
            Throwables.Add(SpawnThrowable(off3 + new Vector3(-1, 0.1f, 0.5f), ThrowableType.Nut));
            SpawnLocker(off3 + new Vector3(-3, 0, -2), 0);
            SpawnFluorescent(off3 + new Vector3(0, 3.1f, 0), new Color(0.7f, 0.85f, 0.95f), 1.1f, flicker: Random.value < 0.3f);

            // --- Security terminal ---
            var term = new GameObject("SecurityTerminal");
            term.transform.SetParent(transform, false);
            term.transform.position = secCenter + new Vector3(1.5f, 0.95f, 1.5f);
            SecurityTerm = term.AddComponent<SecurityTerminal>();
            SecurityTerm.InteractPos = secCenter + new Vector3(1.5f, 1.0f, 2.6f);
        }

        // ==========================================================
        //                  ZONE 2 — MAIN PRODUCTION HALL
        //  Big open space with conveyors, presses, overhead gantry.
        //  Cold blue moonlight through roof holes + warm working lamps.
        // ==========================================================

        private void BuildZone2_MainHall()
        {
            Vector3 origin = new Vector3(-10, 0, -34);
            float w = 50, d = 44, h = HALL_H;

            // Floor
            SpawnPlane(new Vector3(origin.x + w * 0.5f, 0, origin.z + d * 0.5f), new Vector2(w, d),
                       ProceduralTextures.Floor(), new Vector2(w / 2f, d / 2f));

            // Outer walls
            SpawnWall(new Vector3(origin.x + 0.5f, 0, origin.z), new Vector3(0.5f, h, d));
            SpawnWall(new Vector3(origin.x + w, 0, origin.z), new Vector3(0.5f, h, d));
            SpawnWall(new Vector3(origin.x, 0, origin.z), new Vector3(w, h, 0.5f));
            SpawnWall(new Vector3(origin.x, 0, origin.z + d), new Vector3(w, h, 0.5f));

            // Ceiling (with holes — represented by cutouts we skip)
            // For simplicity: full ceiling but with a few gaps.
            SpawnPlane(new Vector3(origin.x + w * 0.5f, h, origin.z + d * 0.5f), new Vector2(w, d),
                       ProceduralTextures.Ceiling(), new Vector2(w / 2f, d / 2f), flip: true);

            // Nav: full floor walkable
            MarkRectWalkable(origin + Vector3.right * 0.5f, w - 1, d - 1);

            // Conveyor belts (3 long ones)
            for (int i = 0; i < 3; i++)
            {
                float x = origin.x + 8 + i * 12;
                SpawnConveyor(new Vector3(x, 0, origin.z + 8), 25f, 1.4f);
            }

            // Hydraulic press machines
            for (int i = 0; i < 4; i++)
            {
                float x = origin.x + 10 + i * 10;
                SpawnPressMachine(new Vector3(x, 0, origin.z + 30));
            }

            // Gantry crane rails along the ceiling
            SpawnGantryRails(origin + new Vector3(0, h - 1.2f, 8), w, d - 12);

            // Moonlight "roof holes": spot lights pointing down in a cold blue
            for (int i = 0; i < 4; i++)
            {
                float x = origin.x + Random.Range(6, w - 6);
                float z = origin.z + Random.Range(6, d - 6);
                SpawnMoonShaft(new Vector3(x, h - 0.1f, z), 6f);
            }

            // A few working warm lamps hanging from ceiling
            for (int i = 0; i < 3; i++)
            {
                float x = origin.x + 10 + i * 15;
                float z = origin.z + 18;
                SpawnWorkLamp(new Vector3(x, h - 2f, z));
            }

            // Stack of metal barrels + throwables
            for (int i = 0; i < 3; i++)
                SpawnBarrel(origin + new Vector3(4 + i * 1.3f, 0, 36));
            Throwables.Add(SpawnThrowable(origin + new Vector3(7, 0.1f, 36), ThrowableType.Pipe));
            Throwables.Add(SpawnThrowable(origin + new Vector3(8, 0.1f, 37), ThrowableType.Bottle));
            Throwables.Add(SpawnThrowable(origin + new Vector3(6, 0.1f, 35), ThrowableType.Nut));

            // Lockers along side wall
            for (int i = 0; i < 4; i++)
                SpawnLocker(origin + new Vector3(2, 0, 12 + i * 1.2f), 90);
            // Lockers on opposite side
            for (int i = 0; i < 3; i++)
                SpawnLocker(origin + new Vector3(w - 2, 0, 14 + i * 1.2f), -90);

            // A key on a pressed palette
            Keys.Add(SpawnKey(origin + new Vector3(22, 1.3f, 15)));

            // Monster spawns in the far corner of the hall
            MonsterSpawn = origin + new Vector3(w - 5, 0, d - 5);

            // CCTV camera for main hall (Camera 01)
            CCTVCameras.Add(new CctvCameraSpec
            {
                Label = "CAM 01 — MAIN HALL",
                Position = origin + new Vector3(w * 0.5f, h - 1f, 2f),
                LookAt = origin + new Vector3(w * 0.5f, 1.5f, d * 0.5f),
            });

            // CCTV for corridor entry (Camera 04 — admin corridor)
            CCTVCameras.Insert(0, new CctvCameraSpec
            {
                Label = "CAM 04 — CORRIDOR",
                Position = new Vector3(-11f, 2.8f, -24f),
                LookAt = new Vector3(-22f, 1.2f, -24f),
            });
        }

        // ==========================================================
        //               ZONE 3 — WAREHOUSE
        //  Tall shelving with crates and barrels, broken windows.
        // ==========================================================

        private void BuildZone3_Warehouse()
        {
            Vector3 origin = new Vector3(40, 0, -34);
            float w = 26, d = 44, h = 8f;

            BuildRoomBox(origin, w, d, h, ProceduralTextures.Floor(), ProceduralTextures.Wall(), ProceduralTextures.Ceiling());
            MarkRectWalkable(origin + Vector3.right * 0.5f, w - 1, d - 1);

            // Connection to main hall (west wall) — carve a 4m opening
            // We just add extra walkable; visual opening is left implicit.
            MarkWalkable(origin + new Vector3(0, 0, d * 0.5f), 2, 4);

            // Shelves: 4 rows of high shelves along Z
            for (int row = 0; row < 4; row++)
            {
                float x = origin.x + 4 + row * 5.5f;
                SpawnWarehouseShelf(new Vector3(x, 0, origin.z + 3), d - 6, 4);
            }

            // Broken windows on the east wall (emit exterior bluish light)
            for (int i = 0; i < 5; i++)
            {
                float z = origin.z + 6 + i * 7;
                SpawnBrokenWindow(new Vector3(origin.x + w - 0.1f, 2.2f, z));
            }

            // Barrels + throwables around
            for (int i = 0; i < 6; i++)
            {
                float x = origin.x + Random.Range(2, w - 2);
                float z = origin.z + Random.Range(2, d - 2);
                SpawnBarrel(new Vector3(x, 0, z));
            }
            Throwables.Add(SpawnThrowable(origin + new Vector3(w * 0.5f, 0.1f, d * 0.5f), ThrowableType.Bottle));
            Throwables.Add(SpawnThrowable(origin + new Vector3(w * 0.5f - 0.5f, 0.1f, d * 0.5f + 0.3f), ThrowableType.Pipe));
            Throwables.Add(SpawnThrowable(origin + new Vector3(w * 0.5f + 1, 0.1f, d * 0.5f), ThrowableType.Can));

            // KEY: third key hidden deep in warehouse
            Keys.Add(SpawnKey(origin + new Vector3(w - 4, 1.0f, d - 6)));

            // A locker
            SpawnLocker(origin + new Vector3(2, 0, d - 3), 90);

            // Dim cold fluorescent
            SpawnFluorescent(origin + new Vector3(w * 0.5f, h - 0.3f, d * 0.3f), new Color(0.5f, 0.7f, 0.85f), 2.0f, flicker: true);
            SpawnFluorescent(origin + new Vector3(w * 0.5f, h - 0.3f, d * 0.7f), new Color(0.5f, 0.7f, 0.85f), 2.0f, flicker: false);

            // CCTV camera for warehouse (Camera 02)
            CCTVCameras.Add(new CctvCameraSpec
            {
                Label = "CAM 02 — WAREHOUSE",
                Position = origin + new Vector3(1.5f, h - 0.5f, d - 2f),
                LookAt = origin + new Vector3(w * 0.5f, 1.2f, d * 0.3f),
            });
        }

        // ==========================================================
        //               ZONE 4 — VENTILATION DUCTS
        //  Low, narrow metallic tunnels. Shortcut between hall and warehouse.
        // ==========================================================

        private void BuildZone4_Vents()
        {
            // A single L-shaped duct running under the hall ceiling → coming down
            // into a small access room. Player can crouch-walk through.
            // Not walkable in nav grid for monster (monster avoids by design).

            float ductH = DUCT_H;

            // Section 1: along the hall at y = 2m (walk with crouch)
            for (int i = 0; i < 10; i++)
            {
                Vector3 p = new Vector3(-8 + i * 3f, 2.2f, -28 + (i % 2) * 0.2f);
                SpawnDuctSegment(p, 3f, ductH, facing: Vector3.right);
            }

            // Short vertical entrance vent near admin corridor end
            var entrance = new Vector3(-11f, 0, -24f);
            var go = new GameObject("VentGrate");
            go.transform.SetParent(transform, false);
            go.transform.position = entrance + new Vector3(0, 0.65f, 0);
            var rend = CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.05f, 1.3f, 1.2f), ProceduralTextures.StripedMetal());
            // no collider so player can pass
            var col = rend.GetComponent<Collider>(); if (col) Destroy(col);
        }

        // ==========================================================
        //               ZONE 5 — OUTDOOR YARD + YELLOW TRUCK
        // ==========================================================

        private void BuildZone5_Yard()
        {
            // Big outdoor area outside the south of the warehouse/main hall.
            Vector3 origin = new Vector3(-30, 0, 20);
            float w = 100, d = 40;

            // Asphalt ground
            SpawnPlane(new Vector3(origin.x + w * 0.5f, 0.01f, origin.z + d * 0.5f), new Vector2(w, d),
                       ProceduralTextures.Asphalt(), new Vector2(w / 2f, d / 2f));

            // Invisible nav walkable area
            MarkRectWalkable(origin + new Vector3(1, 0, 1), w - 2, d - 2);

            // Outer fence walls (low)
            float fh = 2.8f;
            SpawnWall(new Vector3(origin.x, 0, origin.z + d - 0.25f), new Vector3(w, fh, 0.4f));
            SpawnWall(new Vector3(origin.x, 0, origin.z), new Vector3(0.4f, fh, d));
            SpawnWall(new Vector3(origin.x + w, 0, origin.z), new Vector3(0.4f, fh, d));

            // Grass patches (green dirt)
            for (int i = 0; i < 30; i++)
            {
                Vector3 p = origin + new Vector3(Random.Range(5, w - 5), 0.02f, Random.Range(3, d - 3));
                SpawnGrassPatch(p);
            }

            // Rusty containers scattered
            for (int i = 0; i < 6; i++)
            {
                Vector3 p = origin + new Vector3(Random.Range(8, w - 8), 0, Random.Range(6, d - 6));
                SpawnContainer(p, Random.Range(0, 4) * 90f);
            }

            // Abandoned cars
            for (int i = 0; i < 3; i++)
            {
                Vector3 p = origin + new Vector3(Random.Range(10, w - 10), 0, Random.Range(5, d - 8));
                SpawnOldCar(p);
            }

            // Street lamp over the truck
            Vector3 truckPos = origin + new Vector3(w * 0.6f, 0, d * 0.5f);
            SpawnStreetLamp(truckPos + new Vector3(0, 0, -5));

            // The yellow KAMAZ truck
            var truckGO = SpawnYellowKamaz(truckPos);
            Truck = truckGO.AddComponent<TruckStarter>();
            Truck.Position = truckPos;
            Truck.InteractPos = truckPos + new Vector3(-1.8f, 1.0f, -1.5f);

            // CCTV camera for outdoor (Camera 03)
            CCTVCameras.Add(new CctvCameraSpec
            {
                Label = "CAM 03 — YARD",
                Position = truckPos + new Vector3(-6, 3.2f, -8),
                LookAt = truckPos + new Vector3(0, 1.2f, 0),
            });

            // Wall between yard and main hall along its north edge would block nav; we leave it open
            // at the middle so player can enter yard from the main hall south wall.
            // Carve walkable between Zone 2 floor and yard floor.
            MarkWalkable(new Vector3(15, 0, 15), 3, 8); // generous gap
        }

        // ==========================================================
        //                    PRIMITIVE BUILDERS
        // ==========================================================

        private void BuildRoomBox(Vector3 origin, float w, float d, float h, Material floor, Material wall, Material ceil)
        {
            // Floor
            SpawnPlane(new Vector3(origin.x + w * 0.5f, 0, origin.z + d * 0.5f), new Vector2(w, d), floor, new Vector2(w / 2f, d / 2f));
            // Ceiling
            SpawnPlane(new Vector3(origin.x + w * 0.5f, h, origin.z + d * 0.5f), new Vector2(w, d), ceil, new Vector2(w / 2f, d / 2f), flip: true);
            // Walls
            SpawnWall(new Vector3(origin.x, 0, origin.z), new Vector3(0.25f, h, d), wall);
            SpawnWall(new Vector3(origin.x + w - 0.25f, 0, origin.z), new Vector3(0.25f, h, d), wall);
            SpawnWall(new Vector3(origin.x, 0, origin.z), new Vector3(w, h, 0.25f), wall);
            SpawnWall(new Vector3(origin.x, 0, origin.z + d - 0.25f), new Vector3(w, h, 0.25f), wall);
        }

        private GameObject SpawnPlane(Vector3 center, Vector2 size, Material mat, Vector2 tile, bool flip = false)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
            go.name = "Plane";
            go.transform.SetParent(transform, false);
            go.transform.position = center;
            // Plane is 10×10 at scale 1 → so scale = size/10
            go.transform.localScale = new Vector3(size.x / 10f, 1, size.y / 10f);
            if (flip) go.transform.rotation = Quaternion.Euler(180, 0, 0);
            var rend = go.GetComponent<Renderer>();
            var m = new Material(mat);
            m.mainTextureScale = tile;
            rend.sharedMaterial = m;
            return go;
        }

        private GameObject SpawnWall(Vector3 corner, Vector3 size, Material mat = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Wall";
            go.transform.SetParent(transform, false);
            go.transform.position = corner + size * 0.5f;
            go.transform.localScale = size;
            var rend = go.GetComponent<Renderer>();
            rend.sharedMaterial = mat ?? ProceduralTextures.Wall();
            var col = go.GetComponent<Collider>();
            BlockingColliders.Add(col);

            // Mark those cells as unwalkable
            Vector2Int a = WorldToCell(corner);
            Vector2Int b = WorldToCell(corner + size);
            for (int y = a.y; y <= b.y; y++)
                for (int x = a.x; x <= b.x; x++)
                    if (InRange(x, y)) _walk[y, x] = false;

            return go;
        }

        private void MarkRectWalkable(Vector3 corner, float w, float d)
        {
            Vector2Int a = WorldToCell(corner);
            Vector2Int b = WorldToCell(corner + new Vector3(w, 0, d));
            for (int y = a.y; y <= b.y; y++)
                for (int x = a.x; x <= b.x; x++)
                    if (InRange(x, y)) _walk[y, x] = true;
        }

        private void MarkWalkable(Vector3 corner, float w, float d)
        {
            MarkRectWalkable(corner, w, d);
        }

        private Vector2Int WorldToCell(Vector3 pos)
        {
            int cx = Mathf.FloorToInt((pos.x - _origin.x) / CELL);
            int cy = Mathf.FloorToInt((pos.z - _origin.y) / CELL);
            return new Vector2Int(cx, cy);
        }

        private bool InRange(int x, int y) => x >= 0 && y >= 0 && x < _gw && y < _gh;

        private GameObject CreatePrim(PrimitiveType t, Transform parent, Vector3 scale, Material mat, Vector3? localPos = null, bool addCollider = true)
        {
            var go = GameObject.CreatePrimitive(t);
            go.transform.SetParent(parent, false);
            go.transform.localScale = scale;
            if (localPos.HasValue) go.transform.localPosition = localPos.Value;
            var rend = go.GetComponent<Renderer>();
            rend.sharedMaterial = mat;
            if (!addCollider)
            {
                var col = go.GetComponent<Collider>();
                if (col) Destroy(col);
            }
            return go;
        }

        // ==========================================================
        //                       FURNITURE
        // ==========================================================

        private GameObject SpawnDesk(Vector3 pos)
        {
            var root = new GameObject("Desk");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(1.6f, 0.08f, 0.9f), ProceduralTextures.Wood(), new Vector3(0, 0.8f, 0));
            for (int i = 0; i < 4; i++)
            {
                float dx = (i % 2 == 0) ? -0.7f : 0.7f;
                float dz = (i < 2) ? -0.35f : 0.35f;
                CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.08f, 0.8f, 0.08f), ProceduralTextures.Wood(), new Vector3(dx, 0.4f, dz));
            }
            return root;
        }

        private GameObject SpawnChair(Vector3 pos)
        {
            var root = new GameObject("Chair");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.5f, 0.08f, 0.5f), ProceduralTextures.Wood(), new Vector3(0, 0.5f, 0));
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.5f, 0.6f, 0.08f), ProceduralTextures.Wood(), new Vector3(0, 0.8f, -0.22f));
            for (int i = 0; i < 4; i++)
            {
                float dx = (i % 2 == 0) ? -0.22f : 0.22f;
                float dz = (i < 2) ? -0.22f : 0.22f;
                CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.06f, 0.5f, 0.06f), ProceduralTextures.Wood(), new Vector3(dx, 0.25f, dz));
            }
            return root;
        }

        /// <param name="isMain">If true, this CRT is the active CCTV terminal screen (emissive stronger).</param>
        private GameObject SpawnCRT(Transform parent, Vector3 localPos, Color tint, bool isMain = false, Transform parentOverride = null)
        {
            var root = new GameObject("CRT");
            if (parent != null) root.transform.SetParent(parent, false);
            else root.transform.SetParent(parentOverride ?? transform, false);
            root.transform.localPosition = localPos;
            // Bulky body
            var bodyMat = ProceduralTextures.Solid(new Color(0.18f, 0.16f, 0.14f), 0.15f);
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.5f, 0.4f, 0.5f), bodyMat, Vector3.zero);
            // Screen
            var screenMat = ProceduralTextures.Solid(Color.black, 0.9f, 0.1f,
                emission: isMain ? new Color(0.15f, 0.9f, 0.4f) : tint);
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.36f, 0.3f, 0.04f), screenMat, new Vector3(0, 0.02f, 0.26f));
            return root;
        }

        private GameObject SpawnLocker(Vector3 pos, float rotY)
        {
            var root = new GameObject("Locker");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            root.transform.rotation = Quaternion.Euler(0, rotY, 0);
            float w = 0.9f, h = 1.9f, d = 0.55f;
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(w, h, d), ProceduralTextures.StripedMetal(), new Vector3(0, h * 0.5f, 0));
            // door (slightly lighter)
            var door = CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(w * 0.95f, h * 0.95f, 0.04f),
                                  ProceduralTextures.Solid(new Color(0.45f, 0.48f, 0.52f), 0.4f, 0.5f), new Vector3(0, h * 0.5f, d * 0.5f + 0.02f));
            // handle
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.05f, 0.12f, 0.05f), ProceduralTextures.Solid(Color.gray, 0.6f, 0.4f), new Vector3(w * 0.3f, h * 0.5f - 0.1f, d * 0.5f + 0.08f));

            var spot = root.AddComponent<HidingSpot>();
            spot.Door = door.transform;
            spot.EntryOffset = new Vector3(0, 0, d * 0.5f + 0.6f);
            HidingSpots.Add(spot);
            return root;
        }

        private GameObject SpawnCoatRack(Vector3 pos)
        {
            var root = new GameObject("CoatRack");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            // Pole
            CreatePrim(PrimitiveType.Cylinder, root.transform, new Vector3(0.04f, 0.9f, 0.04f), ProceduralTextures.Solid(new Color(0.2f, 0.2f, 0.2f), 0.4f, 0.7f), new Vector3(0, 0.9f, 0));
            // Horizontal top
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.04f, 0.04f, 0.8f), ProceduralTextures.Solid(new Color(0.2f, 0.2f, 0.2f), 0.4f, 0.7f), new Vector3(0, 1.78f, 0));
            // Coat
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.5f, 0.9f, 0.1f), ProceduralTextures.Fabric(), new Vector3(0.2f, 1.25f, 0));
            return root;
        }

        private void SpawnPapers(Vector3 pos, int count)
        {
            var root = new GameObject("Papers");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            for (int i = 0; i < count; i++)
            {
                Vector3 lp = new Vector3(Random.Range(-0.8f, 0.8f), 0.001f * i, Random.Range(-0.8f, 0.8f));
                var p = CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.18f, 0.005f, 0.25f), ProceduralTextures.Paper(), lp, addCollider: false);
                p.transform.localRotation = Quaternion.Euler(0, Random.Range(0, 360), 0);
            }
        }

        private void SpawnMug(Vector3 pos)
        {
            var root = new GameObject("Mug");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            var mat = ProceduralTextures.Solid(new Color(0.88f, 0.88f, 0.85f), 0.3f);
            CreatePrim(PrimitiveType.Cylinder, root.transform, new Vector3(0.08f, 0.06f, 0.08f), mat, Vector3.zero);
        }

        private void SpawnConveyor(Vector3 pos, float length, float width)
        {
            var root = new GameObject("Conveyor");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            var beltMat = ProceduralTextures.Solid(new Color(0.12f, 0.12f, 0.12f), 0.6f);
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(width, 0.1f, length), beltMat, new Vector3(0, 0.8f, length * 0.5f));
            var frameMat = ProceduralTextures.RustMetal();
            // Side rails
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.1f, 1.0f, length), frameMat, new Vector3(-width * 0.5f - 0.05f, 0.5f, length * 0.5f));
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.1f, 1.0f, length), frameMat, new Vector3(width * 0.5f + 0.05f, 0.5f, length * 0.5f));
            // Rollers (visual)
            for (int i = 0; i < length; i += 2)
            {
                var r = CreatePrim(PrimitiveType.Cylinder, root.transform, new Vector3(width * 0.45f, 0.08f, width * 0.45f), frameMat, new Vector3(0, 0.85f, i + 1));
                r.transform.localRotation = Quaternion.Euler(90, 0, 0);
            }
        }

        private void SpawnPressMachine(Vector3 pos)
        {
            var root = new GameObject("Press");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            var rust = ProceduralTextures.RustMetal();
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(2.5f, 3.2f, 2.0f), rust, new Vector3(0, 1.6f, 0));
            // Ram
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(1.8f, 0.5f, 1.5f), ProceduralTextures.Solid(new Color(0.35f, 0.3f, 0.25f), 0.5f, 0.7f), new Vector3(0, 2.3f, 0));
            // Base plate
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(2.8f, 0.3f, 2.3f), rust, new Vector3(0, 0.15f, 0));
            // Control panel
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.4f, 0.5f, 0.3f), ProceduralTextures.Solid(new Color(0.5f, 0.45f, 0.15f), 0.2f), new Vector3(1.4f, 1.3f, 0.9f));
        }

        private void SpawnGantryRails(Vector3 origin, float w, float d)
        {
            var mat = ProceduralTextures.RustMetal();
            var root = new GameObject("Gantry");
            root.transform.SetParent(transform, false);
            // Two parallel rails along Z
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.3f, 0.4f, d), mat, origin + new Vector3(w * 0.25f, 0, d * 0.5f));
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.3f, 0.4f, d), mat, origin + new Vector3(w * 0.75f, 0, d * 0.5f));
            // Gantry bridge
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(w * 0.5f + 0.5f, 0.25f, 0.4f), mat, origin + new Vector3(w * 0.5f, 0, d * 0.35f));
            // Hook
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.05f, 2.0f, 0.05f), mat, origin + new Vector3(w * 0.5f, -1.0f, d * 0.35f));
            CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.3f, 0.1f, 0.3f), ProceduralTextures.Solid(new Color(0.3f, 0.3f, 0.3f), 0.5f, 0.7f), origin + new Vector3(w * 0.5f, -2.0f, d * 0.35f));
        }

        private void SpawnBarrel(Vector3 pos)
        {
            var go = new GameObject("Barrel");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, Random.Range(0, 360), 0);
            CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.8f, 0.6f, 0.8f), ProceduralTextures.RustMetal(), new Vector3(0, 0.6f, 0));
            // Rings
            CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.83f, 0.03f, 0.83f), ProceduralTextures.Solid(new Color(0.25f, 0.15f, 0.08f), 0.3f, 0.6f), new Vector3(0, 0.25f, 0));
            CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.83f, 0.03f, 0.83f), ProceduralTextures.Solid(new Color(0.25f, 0.15f, 0.08f), 0.3f, 0.6f), new Vector3(0, 0.95f, 0));
        }

        private void SpawnWarehouseShelf(Vector3 pos, float length, int levels)
        {
            var root = new GameObject("Shelf");
            root.transform.SetParent(transform, false);
            root.transform.position = pos;
            var frame = ProceduralTextures.RustMetal();

            // Uprights
            for (int i = 0; i <= Mathf.FloorToInt(length / 4); i++)
            {
                CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.1f, 6f, 0.1f), frame, new Vector3(-0.8f, 3f, i * 4f));
                CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.1f, 6f, 0.1f), frame, new Vector3(0.8f, 3f, i * 4f));
            }
            // Shelves
            for (int lv = 1; lv <= levels; lv++)
            {
                float y = lv * 1.3f;
                CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(1.8f, 0.08f, length), frame, new Vector3(0, y, length * 0.5f));
                // Random crates per shelf
                for (int c = 0; c < length / 2f; c++)
                {
                    if (Random.value < 0.6f)
                    {
                        float z = c * 2f + Random.Range(0f, 1.5f);
                        var m = ProceduralTextures.Wood();
                        CreatePrim(PrimitiveType.Cube, root.transform, new Vector3(0.9f, 0.8f, 1.4f), m, new Vector3(Random.Range(-0.3f, 0.3f), y + 0.5f, z));
                    }
                }
            }
        }

        private void SpawnBrokenWindow(Vector3 pos)
        {
            var go = new GameObject("Window");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.05f, 1.6f, 2.0f), ProceduralTextures.Window(), Vector3.zero, addCollider: false);
            // Bluish spotlight from outside pointing in
            var lgo = new GameObject("WinLight");
            lgo.transform.SetParent(go.transform, false);
            lgo.transform.localPosition = new Vector3(-1.5f, 0, 0);
            lgo.transform.localRotation = Quaternion.Euler(0, 90, 0);
            var l = lgo.AddComponent<Light>();
            l.type = LightType.Spot;
            l.color = new Color(0.55f, 0.72f, 0.9f);
            l.intensity = 1.3f;
            l.range = 14f;
            l.spotAngle = 80f;
        }

        private void SpawnFluorescent(Vector3 pos, Color col, float intensity, bool flicker)
        {
            var go = new GameObject("Fluorescent");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            // Tube mesh
            var tube = CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.2f, 0.06f, 0.15f),
                ProceduralTextures.Solid(new Color(0.95f, 0.95f, 0.9f), 0.3f, 0.1f, emission: col * 1.5f), Vector3.zero, addCollider: false);
            var lgo = new GameObject("L");
            lgo.transform.SetParent(go.transform, false);
            var l = lgo.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = col;
            l.intensity = intensity;
            l.range = 10f;

            var fl = go.AddComponent<FlickerLight>();
            fl.Light = l;
            fl.BaseIntensity = intensity;
            fl.DoFlicker = flicker;
            fl.TubeRenderer = tube.GetComponent<Renderer>();
            fl.TubeMaterial = tube.GetComponent<Renderer>().sharedMaterial;
            fl.EmissionColor = col * 1.5f;
            FlickerLights.Add(fl);

            // Buzz audio
            var src = go.AddComponent<AudioSource>();
            src.clip = ProceduralAudio.Instance.LightBuzz;
            src.loop = true;
            src.volume = 0.12f;
            src.spatialBlend = 1f;
            src.minDistance = 1f;
            src.maxDistance = 8f;
            src.Play();
        }

        private void SpawnMoonShaft(Vector3 pos, float radius)
        {
            var go = new GameObject("MoonShaft");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(90, 0, 0);
            var l = go.AddComponent<Light>();
            l.type = LightType.Spot;
            l.color = new Color(0.6f, 0.78f, 1.0f);
            l.intensity = 2.2f;
            l.range = 18f;
            l.spotAngle = 50f;
            l.shadows = LightShadows.Soft;

            // Dust beam (cone mesh, transparent)
            var beamMat = new Material(Shader.Find("Particles/Standard Unlit"));
            if (beamMat.shader == null) beamMat = new Material(Shader.Find("Standard"));
            beamMat.color = new Color(0.6f, 0.78f, 1.0f, 0.08f);
            beamMat.SetColor("_EmissionColor", new Color(0.6f, 0.78f, 1.0f) * 0.3f);
            if (beamMat.HasProperty("_Mode")) beamMat.SetFloat("_Mode", 2f);
            beamMat.EnableKeyword("_ALPHABLEND_ON");
            beamMat.DisableKeyword("_ALPHATEST_ON");
            beamMat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            beamMat.renderQueue = 3000;
            beamMat.SetInt("_ZWrite", 0);
            beamMat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            beamMat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.One);
            var cone = CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(radius * 1.4f, 9f, radius * 1.4f), beamMat, new Vector3(0, -9f, 0), addCollider: false);
            cone.transform.localRotation = Quaternion.identity;
        }

        private void SpawnWorkLamp(Vector3 pos)
        {
            var go = new GameObject("WorkLamp");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            // Shade
            var shade = CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.45f, 0.12f, 0.45f), ProceduralTextures.Solid(new Color(0.25f, 0.2f, 0.15f), 0.4f, 0.3f), Vector3.zero, addCollider: false);
            // Bulb
            CreatePrim(PrimitiveType.Sphere, go.transform, new Vector3(0.2f, 0.2f, 0.2f), ProceduralTextures.Solid(new Color(1, 0.85f, 0.5f), 0.3f, 0, emission: new Color(2f, 1.4f, 0.6f)), new Vector3(0, -0.15f, 0), addCollider: false);
            // Light
            var lgo = new GameObject("L");
            lgo.transform.SetParent(go.transform, false);
            lgo.transform.localPosition = new Vector3(0, -0.2f, 0);
            var l = lgo.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = new Color(1f, 0.78f, 0.45f);
            l.intensity = 1.6f;
            l.range = 10f;

            // Cord
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.02f, 2f, 0.02f), ProceduralTextures.Solid(Color.black, 0.2f), new Vector3(0, 1f, 0), addCollider: false);
        }

        private void SpawnStreetLamp(Vector3 pos)
        {
            var go = new GameObject("StreetLamp");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            // Pole
            CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.18f, 3f, 0.18f), ProceduralTextures.Solid(new Color(0.15f, 0.15f, 0.17f), 0.3f, 0.6f), new Vector3(0, 3f, 0));
            // Arm
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.2f, 0.1f, 0.1f), ProceduralTextures.Solid(new Color(0.15f, 0.15f, 0.17f), 0.3f, 0.6f), new Vector3(0.5f, 6f, 0), addCollider: false);
            // Shade
            CreatePrim(PrimitiveType.Sphere, go.transform, new Vector3(0.5f, 0.3f, 0.5f), ProceduralTextures.Solid(new Color(0.1f, 0.1f, 0.1f), 0.3f, 0.4f), new Vector3(1.1f, 5.9f, 0), addCollider: false);

            var lgo = new GameObject("L");
            lgo.transform.SetParent(go.transform, false);
            lgo.transform.localPosition = new Vector3(1.1f, 5.8f, 0);
            var l = lgo.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = new Color(1f, 0.75f, 0.4f);
            l.intensity = 2.4f;
            l.range = 18f;
            l.shadows = LightShadows.Soft;
        }

        private void SpawnContainer(Vector3 pos, float rotY)
        {
            var go = new GameObject("Container");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, rotY, 0);
            Color[] tints = { new Color(0.5f, 0.15f, 0.12f), new Color(0.15f, 0.35f, 0.5f), new Color(0.5f, 0.45f, 0.15f), new Color(0.3f, 0.3f, 0.3f) };
            var m = new Material(ProceduralTextures.RustMetal());
            m.color = tints[Random.Range(0, tints.Length)];
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(6.1f, 2.6f, 2.4f), m, new Vector3(0, 1.3f, 0));
        }

        private void SpawnOldCar(Vector3 pos)
        {
            var go = new GameObject("OldCar");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, Random.Range(0, 360), 0);
            var body = ProceduralTextures.Solid(new Color(0.35f, 0.35f, 0.33f), 0.4f, 0.3f);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.8f, 0.8f, 4.0f), body, new Vector3(0, 0.6f, 0));
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.6f, 0.6f, 1.6f), body, new Vector3(0, 1.3f, -0.2f));
            var glass = ProceduralTextures.Glass();
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.5f, 0.5f, 0.05f), glass, new Vector3(0, 1.3f, 0.6f), addCollider: false);
            // Wheels
            var tire = ProceduralTextures.Tire();
            for (int i = 0; i < 4; i++)
            {
                float dx = (i % 2 == 0) ? -0.85f : 0.85f;
                float dz = (i < 2) ? -1.3f : 1.3f;
                var w = CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.35f, 0.1f, 0.35f), tire, new Vector3(dx, 0.35f, dz));
                w.transform.localRotation = Quaternion.Euler(0, 0, 90);
            }
        }

        private GameObject SpawnYellowKamaz(Vector3 pos)
        {
            var go = new GameObject("YellowKamaz");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;

            var y = ProceduralTextures.Yellow();
            var dy = ProceduralTextures.DarkYellow();
            var glass = ProceduralTextures.Glass();
            var tire = ProceduralTextures.Tire();

            // Cab
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.4f, 2.0f, 2.2f), y, new Vector3(0, 1.7f, -1.5f));
            // Roof
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.4f, 0.12f, 2.2f), dy, new Vector3(0, 2.76f, -1.5f), addCollider: false);
            // Hood (engine)
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.2f, 1.2f, 2.0f), y, new Vector3(0, 1.3f, 0.2f));
            // Windshield
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.1f, 1.0f, 0.06f), glass, new Vector3(0, 2.2f, -0.4f), addCollider: false);
            // Side windows
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.06f, 0.9f, 1.4f), glass, new Vector3(-1.22f, 2.3f, -1.5f), addCollider: false);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.06f, 0.9f, 1.4f), glass, new Vector3(1.22f, 2.3f, -1.5f), addCollider: false);
            // Flatbed
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.6f, 0.2f, 4f), dy, new Vector3(0, 1.25f, -4.8f));
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.6f, 0.8f, 0.15f), dy, new Vector3(0, 1.7f, -6.8f), addCollider: false);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.15f, 0.8f, 4f), dy, new Vector3(-1.25f, 1.7f, -4.8f), addCollider: false);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.15f, 0.8f, 4f), dy, new Vector3(1.25f, 1.7f, -4.8f), addCollider: false);
            // Wheels — 6 (KAMAZ 6×4 style)
            for (int i = 0; i < 6; i++)
            {
                float dx = (i % 2 == 0) ? -1.1f : 1.1f;
                float dz;
                if (i < 2) dz = 0.6f;
                else if (i < 4) dz = -3.8f;
                else dz = -5.1f;
                var w = CreatePrim(PrimitiveType.Cylinder, go.transform, new Vector3(0.6f, 0.22f, 0.6f), tire, new Vector3(dx, 0.6f, dz));
                w.transform.localRotation = Quaternion.Euler(0, 0, 90);
            }
            // Grille
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.8f, 0.4f, 0.1f), ProceduralTextures.Solid(new Color(0.12f, 0.12f, 0.12f), 0.4f, 0.7f), new Vector3(0, 1.1f, 1.25f));
            // Headlights
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.38f, 0.22f, 0.12f), ProceduralTextures.Solid(new Color(1, 0.97f, 0.75f), 0.4f, 0.1f, emission: new Color(1.2f, 0.9f, 0.5f)), new Vector3(-0.8f, 1.35f, 1.3f), addCollider: false);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.38f, 0.22f, 0.12f), ProceduralTextures.Solid(new Color(1, 0.97f, 0.75f), 0.4f, 0.1f, emission: new Color(1.2f, 0.9f, 0.5f)), new Vector3(0.8f, 1.35f, 1.3f), addCollider: false);
            // Bumper
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(2.4f, 0.22f, 0.14f), ProceduralTextures.Solid(new Color(0.15f, 0.15f, 0.15f), 0.4f, 0.7f), new Vector3(0, 0.7f, 1.3f));
            // KAMAZ logo stripe
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(1.2f, 0.15f, 0.05f), ProceduralTextures.Solid(Color.black, 0.5f, 0.3f), new Vector3(0, 2.5f, 0.58f), addCollider: false);
            return go;
        }

        private void SpawnDuctSegment(Vector3 pos, float length, float h, Vector3 facing)
        {
            var go = new GameObject("Duct");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            if (Mathf.Abs(facing.z) > 0.5f) go.transform.rotation = Quaternion.Euler(0, 90, 0);
            var mat = ProceduralTextures.StripedMetal();
            // Box: thin walls, open ends
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(length, 0.05f, 1.0f), mat, new Vector3(0, 0, 0.5f), addCollider: false); // floor
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(length, 0.05f, 1.0f), mat, new Vector3(0, h, 0.5f), addCollider: false); // ceil
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(length, h, 0.05f), mat, new Vector3(0, h * 0.5f, 0), addCollider: false);
            CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(length, h, 0.05f), mat, new Vector3(0, h * 0.5f, 1.0f), addCollider: false);
        }

        private void SpawnGrassPatch(Vector3 pos)
        {
            var go = new GameObject("Grass");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            var m = ProceduralTextures.Solid(new Color(0.15f, 0.28f, 0.12f), 0.9f);
            for (int i = 0; i < 5; i++)
            {
                float h = Random.Range(0.3f, 0.7f);
                var b = CreatePrim(PrimitiveType.Cube, go.transform, new Vector3(0.03f, h, 0.03f), m, new Vector3(Random.Range(-0.3f, 0.3f), h * 0.5f, Random.Range(-0.3f, 0.3f)), addCollider: false);
                b.transform.localRotation = Quaternion.Euler(Random.Range(-10, 10), Random.Range(0, 360), Random.Range(-10, 10));
            }
        }

        // ==========================================================
        //                    PICKUPS / THROWABLES
        // ==========================================================

        public enum ThrowableType { Bottle, Can, Pipe, Rebar, Nut }

        public Throwable SpawnThrowable(Vector3 pos, ThrowableType type)
        {
            var go = new GameObject($"Throwable_{type}");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;

            var t = go.AddComponent<Throwable>();
            t.Type = type;
            t.SpawnPos = pos;
            t.BuildVisual();
            return t;
        }

        public Pickup SpawnKey(Vector3 pos)
        {
            var go = new GameObject("Key");
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            var p = go.AddComponent<Pickup>();
            p.Type = Pickup.Kind.Key;
            p.SpawnPos = pos;
            p.BuildVisual();
            return p;
        }
    }

    /// <summary> CCTV camera placement spec returned from LevelBuilder. </summary>
    public struct CctvCameraSpec
    {
        public string Label;
        public Vector3 Position;
        public Vector3 LookAt;
    }
}
