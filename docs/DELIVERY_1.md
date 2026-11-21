# 1ª entrega — Centro–Batel jogável

## Funcionalidades implementadas

- Área ~600 m com **mapa esquemático placeholder** (nomes de ruas do Centro–Batel, mas traçado e quadras inventados — **não fiel**; import OSM pendente)
- Personagem humano a pé (caminhar, correr, pular)
- Entrar/sair de veículo (E / botão Entrar–Sair)
- Pedestres animados nas calçadas
- Trânsito leve (carros IA nas vias)
- Ciclo dia/noite simples + faróis
- Minimapa, HUD, presets de qualidade com caps NPC/veículo
- Controle mobile contextual (pé vs dirigir)
- Socket.IO / QR / sessão preservados (`PROTOCOL_VERSION = 2`)

## Assets e licenças

Ver [ASSETS.md](./ASSETS.md).

## Melhorias visuais

- Extrusão de edifícios com fachada texturizada
- Calçadas, faixas, árvores, postes, pontos de ônibus
- Céu/fog dinâmicos

## Desempenho

- Presets Alta / Média / Baixa / Mínima (resolução, sombras, LOD, caps)
- Meta: ~30 FPS em Média na Android TV (validar no aparelho com o monitor FPS)
- Desktop mid: tipicamente acima de 30 FPS no preset Alta

## Compatibilidade Android TV

- Build Vite `es2017` / Chrome 61 mantido
- Android TV inicia em qualidade Média
- Fallback WebGL fatal screen mantido

## Pendências (próximas etapas)

- **Prioridade 1:** importar vias/edifícios reais do OSM (Overpass falhou nesta etapa) e substituir o placeholder
- Expandir para Jardim Botânico / mais bairros (streaming multi-chunk)
- GLB CC0 para personagens/veículos
- Animais, chuva, áudio urbano, semáforos inteligentes, missões
