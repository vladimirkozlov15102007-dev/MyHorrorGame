using System.Collections.Generic;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Simple 2D grid A* pathfinder used by the monster.
    /// Cells are 2m × 2m; XZ plane.
    /// </summary>
    public class NavGrid
    {
        public const float CELL = 2.0f;

        public bool[,] Walk;   // [y, x]
        public int W, H;
        public Vector2 Origin; // world-space XZ of cell (0,0) corner

        public NavGrid(bool[,] walk, Vector2 origin)
        {
            Walk = walk; H = walk.GetLength(0); W = walk.GetLength(1);
            Origin = origin;
        }

        public bool IsWalkable(int cx, int cy)
        {
            return cx >= 0 && cy >= 0 && cx < W && cy < H && Walk[cy, cx];
        }

        public Vector3 CellToWorld(int cx, int cy)
        {
            return new Vector3(Origin.x + cx * CELL + CELL * 0.5f, 0f, Origin.y + cy * CELL + CELL * 0.5f);
        }

        public Vector2Int WorldToCell(float x, float z)
        {
            int cx = Mathf.FloorToInt((x - Origin.x) / CELL);
            int cy = Mathf.FloorToInt((z - Origin.y) / CELL);
            return new Vector2Int(cx, cy);
        }

        private static readonly int[] Dx = { 1, -1, 0, 0, 1, 1, -1, -1 };
        private static readonly int[] Dy = { 0, 0, 1, -1, 1, -1, 1, -1 };

        public List<Vector3> FindPath(Vector3 from, Vector3 to)
        {
            var s = WorldToCell(from.x, from.z);
            var g = WorldToCell(to.x, to.z);
            if (!IsWalkable(s.x, s.y) || !IsWalkable(g.x, g.y)) return null;

            var open = new SortedList<float, int>(new DupComparer());
            var closed = new HashSet<int>();
            var gScore = new Dictionary<int, float>();
            var parent = new Dictionary<int, int>();

            int Key(int x, int y) => y * W + x;
            float Heur(int x, int y) { int dx = Mathf.Abs(x - g.x), dy = Mathf.Abs(y - g.y); return dx + dy + (1.414f - 2f) * Mathf.Min(dx, dy); }

            int sk = Key(s.x, s.y);
            gScore[sk] = 0;
            open.Add(Heur(s.x, s.y), sk);

            int safety = 12000;
            while (open.Count > 0 && safety-- > 0)
            {
                int cur = open.Values[0];
                open.RemoveAt(0);
                if (closed.Contains(cur)) continue;
                closed.Add(cur);

                int cy = cur / W, cx = cur - cy * W;
                if (cx == g.x && cy == g.y)
                {
                    var path = new List<Vector3>();
                    int k = cur;
                    while (parent.ContainsKey(k))
                    {
                        int py = k / W, px = k - py * W;
                        path.Add(CellToWorld(px, py));
                        k = parent[k];
                    }
                    path.Reverse();
                    return path;
                }

                for (int i = 0; i < 8; i++)
                {
                    int nx = cx + Dx[i], ny = cy + Dy[i];
                    if (!IsWalkable(nx, ny)) continue;
                    if (Dx[i] != 0 && Dy[i] != 0 && (!IsWalkable(cx + Dx[i], cy) || !IsWalkable(cx, cy + Dy[i]))) continue;
                    int nk = Key(nx, ny);
                    if (closed.Contains(nk)) continue;
                    float step = (Dx[i] != 0 && Dy[i] != 0) ? 1.414f : 1.0f;
                    float tg = gScore[cur] + step;
                    if (!gScore.TryGetValue(nk, out float prev) || tg < prev)
                    {
                        gScore[nk] = tg;
                        parent[nk] = cur;
                        open.Add(tg + Heur(nx, ny), nk);
                    }
                }
            }
            return null;
        }

        public Vector2Int RandomWalkable()
        {
            for (int i = 0; i < 500; i++)
            {
                int cx = Random.Range(0, W), cy = Random.Range(0, H);
                if (Walk[cy, cx]) return new Vector2Int(cx, cy);
            }
            return new Vector2Int(1, 1);
        }

        // allow duplicate f-scores
        private class DupComparer : IComparer<float>
        {
            public int Compare(float a, float b)
            {
                int c = a.CompareTo(b);
                return c == 0 ? 1 : c;
            }
        }
    }
}
