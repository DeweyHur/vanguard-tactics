import type { MapDef, MapNode, MapEdge, NodeType, PlayerId } from '../types';

function N(id: string, type: NodeType, x: number, y: number, name: string, owner?: PlayerId): MapNode {
  return { id, type, x, y, name, owner };
}

function build(id: string, name: string, w: number, h: number, nodes: MapNode[], links: [string, string][]): MapDef {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges: MapEdge[] = links.map(([a, b]) => {
    const na = byId[a], nb = byId[b];
    if (!na || !nb) throw new Error(`bad edge ${a}-${b}`);
    const len = Math.hypot(na.x - nb.x, na.y - nb.y) / 10;
    return { a, b, len: Math.round(len * 10) / 10 };
  });
  return { id, name, width: w, height: h, nodes, edges };
}

/** Symmetric 1v1 map: two lanes + a central shrine. */
export const MAP_RIVERLANDS: MapDef = build('riverlands', '리버랜드', 800, 500, [
  N('h1', 'home', 60, 250, '서쪽 본진', 'P1'),
  N('w_sup', 'supply', 170, 150, '서쪽 보급소'),
  N('w_bar', 'barracks', 170, 350, '서쪽 병영'),
  N('w_tow', 'watchtower', 290, 80, '북서 감시탑'),
  N('w_fort', 'fort', 290, 250, '서쪽 요새'),
  N('w_pl', 'plain', 290, 420, '남서 들판'),
  N('shrine', 'shrine', 400, 250, '중앙 성소'),
  N('e_tow', 'watchtower', 510, 80, '북동 감시탑'),
  N('e_fort', 'fort', 510, 250, '동쪽 요새'),
  N('e_pl', 'plain', 510, 420, '남동 들판'),
  N('e_sup', 'supply', 630, 150, '동쪽 보급소'),
  N('e_bar', 'barracks', 630, 350, '동쪽 병영'),
  N('h2', 'home', 740, 250, '동쪽 본진', 'P2'),
], [
  ['h1', 'w_sup'], ['h1', 'w_bar'], ['w_sup', 'w_bar'],
  ['w_sup', 'w_tow'], ['w_sup', 'w_fort'], ['w_bar', 'w_fort'], ['w_bar', 'w_pl'],
  ['w_tow', 'e_tow'], ['w_fort', 'shrine'], ['w_pl', 'e_pl'], ['w_tow', 'w_fort'], ['w_fort', 'w_pl'],
  ['shrine', 'e_fort'], ['e_tow', 'e_fort'], ['e_fort', 'e_pl'],
  ['e_tow', 'e_sup'], ['e_fort', 'e_sup'], ['e_fort', 'e_bar'], ['e_pl', 'e_bar'], ['e_sup', 'e_bar'],
  ['e_sup', 'h2'], ['e_bar', 'h2'],
]);

export const MAPS: Record<string, MapDef> = { riverlands: MAP_RIVERLANDS };
