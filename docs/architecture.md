# Архитектура

Исходные SVG сохранены в assets/source; SHA-256 и сопоставление описаны в [asset-provenance.md](asset-provenance.md). scripts/extract-assets.py извлекает реальные контуры, детали, обводки, тени и defs, нормализуя только контейнер/координатное начало. Исходники не изменяются. «20» сопоставлены с 10 типами × S/L, а с двумя состояниями получается 40 вариантов; вымышленных предметов нет.

assets/catalog.json содержит version, sourceHashes, items. У предмета id, русское name, aliases, tags и variants[S|L][main|background] с svg, width, height, source. Палитры violet/peach/teal: background[3], objects[3], ink, paper.

src/core.mjs распознаёт прямые названия и отдельно возвращает неизвестные слова. planComposition(selection,catalog,options) возвращает width,height,scale,placements. Единый масштаб сохраняет относительные размеры исходной версии; headline оставляет место слева. recolorSvg меняет цветовые роли, сохраняя path; фоновые предметы используют background. JSON палитры и метаданные сцены валидируются.

src/openrouter.mjs отправляет метафору и компактные метаданные каталога. Ответ {items:[{id,role}],explanation} проходит whitelist и проверку структуры. Модель не генерирует SVG и координаты. Тайм-аут 45 секунд, один повтор временной ошибки, без платного fallback. Успешный подбор кэшируется по запросу, модели, версии каталога; UI показывает cache. Перекомпоновка локальная.

src/plugin.mjs создаёт createNodeFromSvg, именованные векторные группы и фрейм, применяет общий rescale. src/ui.html и src/ui.mjs предоставляют русский UI и сетевую часть. Протокол: request {requestId,type,payload}, response {requestId,ok,data|error}; init/refresh синхронизируют каталог, палитры и activeScene. Команды compose/add/recolor/relayout/switch-size/export/read-selection.

Private pluginData требуют настоящего Figma-assigned manifest.id; зарегистрированный ID 1703137590700223750 сохраняется одинаковым в source/public/demo. Ранний SVG-импорт без ID не проверял persistence. Scene/asset pluginData позволяют повторно использовать выделенную композицию после перезапуска. Ключи в metadata не попадают. Личный ключ живёт только в RAM UI; встроенный существует только в отдельной private demo. Public build принудительно подставляет пустой ключ. Экспорт берётся из текущих узлов Figma, включая native edits, а не из исходных SVG.

esbuild встраивает UI JS в HTML, а HTML в main. Сервер не нужен; сетевой allowlist ограничен HTTPS OpenRouter. Source ZIP использует allowlist без .env.local/dist/release. Примеры используют тот же core/catalog, namespace для SVG ID предотвращает коллизии defs без изменения геометрии.
