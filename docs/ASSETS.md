# Assets e licenças — Curitiba Open World (1ª entrega)

## Mapa e geografia

| Asset | Fonte | Licença | Notas |
|-------|-------|---------|-------|
| Vias Centro–Batel | **Placeholder escrito à mão** (Overpass falhou) | Original do projeto | Linhas retas aproximadas com nomes de ruas reais só como rótulo. **Não é fiel à malha real.** |
| Edifícios | Grid sintético | Original do projeto | Não derivado de footprints reais |

Nenhum dado OSM está no build atual. Importar o dump real (`node tools/osm-import/fetch.mjs`) é pré-requisito para fidelidade geográfica.

## Modelos 3D

| Asset | Fonte | Licença |
|-------|-------|---------|
| Personagem jogável / NPCs | Procedural (`apps/game/src/actors/Humanoid.ts`) | Original do projeto (uso livre no repo) |
| Veículos | Procedural (`apps/game/src/actors/Vehicle.ts`) | Original do projeto |
| Árvores, postes, pontos de ônibus | Procedural + `InstancedMesh` | Original do projeto |
| Texturas de fachada / solo | CanvasTexture gerada em runtime | Original do projeto |

Nenhum asset de GTA ou de outros jogos comerciais foi utilizado.

## Áudio

Ainda não incluído nesta entrega.

## Próximos upgrades (licenças candidatas)

- Pacotes CC0 (Quaternius / Kenney) para personagens/veículos GLB
- Texturas CC0 (ambientCG / Poly Haven) com compressão KTX2 quando o WebView permitir
