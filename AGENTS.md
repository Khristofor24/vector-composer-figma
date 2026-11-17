<!-- autopilot:start -->
# Vector Composer — плагин Figma

Автоматическая сборка композиций из предоставленной SVG-библиотеки для тестового Junior AI Developer.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять только пользователь.
Прерванную сборку продолжает `/autopilot`.

### Правка без автопилота

Сначала читать `.autopilot/PROGRESS.md`, затем историю изменений после сдачи.
Значимые решения находятся в `docs/adr/`, термины — в `CONTEXT.md`.
После правки записать причину и результат в PROGRESS.md; коммитить только свои файлы.

### История git

Читать только срез под текущий вопрос: `git log --oneline -10 -- <файл>`,
`git log --oneline --grep=R02`, `git show --stat <sha>`, `git blame -L <с>,<по> <файл>`.
Заголовок `Autopilot: сборка сдана` пишет только автопилот.
Коммиты изменений требований сопровождаются трейлером `Requirements: Rxx`.

## Правила проекта

Исходные SVG не изменять. Не генерировать новые предметы. Соблюдать правила S/L, состояний, палитр и относительных размеров из оригиналов.
Секреты не выводить. Встроенный временный ключ разрешён пользователем только для приватного демопакета; публичные исходники и сборка остаются без ключа.
Публикацию и отправку работодателю пользователь согласует отдельно.

## Точки входа и инварианты

- `assets/catalog.json`, `assets/palettes.json`, `scripts/extract-assets.py`: реальные варианты S/L и роли main/background; `assets/source/` — неизменные байты оригиналов. `.gitattributes` отключает преобразование строк для source; не пересохранять SVG редактором.
- `src/core.mjs`: имена, валидация, единый масштаб и раскладки, замена только цветов. `docs/adr/` объясняет ограничения вариантов, палитр и геометрии.
- `src/plugin.mjs`: native Figma-узлы, metadata сцены/предметов и сохранённые карты цветовых ролей. Перекраска сохраняет ручные цвета; экспорт через exportAsync берёт текущие узлы с native edits, не пересобирает SVG из каталога.
- `src/ui.mjs`, `src/ui.html`: UI и requestId/type/payload-протокол адаптера; собственный ключ только в RAM, очистка не включает demo автоматически. `src/openrouter.mjs`: whitelist ответа AI, таймаут/повтор/кэш; browser fetch нельзя вызывать методом обычного объекта — сохранять корректный receiver или вызывать отвязанную функцию.
- `scripts/build.mjs`, `scripts/package.mjs`: public/demo разделены, source ZIP собирается по allowlist. Конфигурация — только имена `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`; `.env.local` и demo-выходы игнорируются git. Не читать/выводить секреты; отзыв временного ключа выполняется вручную.
- `scripts/create-examples.mjs`, `tests/`, `docs/architecture.md`, `docs/verification.md`: воспроизводимые примеры, проверки и границы доказательств. Моки и build не подтверждают настоящий AI/runtime; текущую приёмку смотреть в PROGRESS.md.

## Локальная проверка и запуск

Node.js 22+, зависимости фиксирует package-lock.json; сборщик — esbuild.
В Windows PowerShell использовать `npm.cmd`, если ExecutionPolicy блокирует npm.ps1.
Проверенный набор: `npm.cmd ci`, `npm.cmd run check`, `npm.cmd run build`,
`node scripts/create-examples.mjs`, `node scripts/create-examples.mjs --check`, `npm.cmd run package`.
Это локальный плагин без web-сервера: после package импортировать
`release/public/plugin/manifest.json` в Figma Desktop (Development → Import plugin from manifest).
Регенерация каталога требует Python/PyMuPDF; обычная сборка использует готовый каталог.
PowerShell-скрипты с кириллицей сохранять в UTF-8 с BOM для Windows PowerShell 5.1;
существующие кодировки и байты source сохранять, не нормализовать весь репозиторий.
Private pluginData требует настоящего Figma-assigned manifest.id: успешный импорт SVG без ID не проверяет persistence. Во всех сборках должен сохраняться один ID; регистрационный template лежит отдельно в игнорируемой figma-registration/.

## Особенность текущего Windows-окружения

Изолированный exec после git init возвращает `helper_unknown_error: setup refresh had errors`.
Штатный запрос `sandbox_permissions=require_escalated` с точным обоснованием работает.
Git создан пользователем CodexSandboxOffline; при запуске от Hristofor использовать
`git -c safe.directory="D:/Удалёнка/Codex/Тестовое Junior AI Developer" ...`.
Глобальные safe.directory и настройки Windows не изменять.
Модель по умолчанию фиксирована на бесплатной NVIDIA; случайный free router ранее возвращал пустой ответ. Причина и JSON/reasoning профили: docs/adr/0008-pinned-free-model.md.
<!-- autopilot:end -->
