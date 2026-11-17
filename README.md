# Vector Composer

[**Скачать готовый плагин ZIP**](https://github.com/Khristofor24/vector-composer-figma/releases/latest/download/Vector-Composer.zip)

## Установка и запуск

1. Скачайте готовый ZIP по ссылке выше, распакуйте его и откройте папку `Vector-Composer`.
2. Откройте **Figma Desktop** и любой файл Figma Design с правом редактирования.
3. Щёлкните правой кнопкой по свободному месту холста → **Plugins → Development → Import plugin from manifest…**. Выберите `plugin/manifest.json` из распакованной папки. Рядом должны оставаться `code.js` и `ui.html`.
4. Запустите: **Plugins → Development → Vector Composer**.
5. Для AI прокрутите окно плагина вниз, раскройте **«Подключение OpenRouter»**, вставьте полученный отдельно ключ в **«Личный API-ключ»** и нажмите **«Проверить подключение»**. Ключ вводится заново после закрытия плагина. Выбор по названиям, палитры и SVG работают без ключа.

При следующих запусках используйте пункты 4–5.

[Архитектура](docs/architecture.md) · [AI-инструменты](docs/AI-TOOLS.md) · [Примеры](examples/) · [Проверки](docs/verification.md) · [Сборка из исходников](docs/development.md)
