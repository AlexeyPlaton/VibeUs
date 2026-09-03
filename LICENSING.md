# VibeUs Licensing Model

VibeUs uses a hybrid open-source licensing structure to balance platform integrity with frictionless frontend adoption.

## Component License Mapping

| Component | Path | License | SPDX Identifier |
| :--- | :--- | :--- | :--- |
| **Backend & Services** | `openspec-core/**` | GNU Affero General Public License v3.0 | `AGPL-3.0-only` |
| **CLI & Local Bridge** | `openspec-cli/**` | GNU Affero General Public License v3.0 | `AGPL-3.0-only` |
| **Embeddable Widget & Web** | `openspec-web/**` | MIT License | `MIT` |
| **Compiled Widget Assets** | `openspec-core/static/vibus-widget.umd.cjs`, `openspec-core/static/vibus-widget.css` | MIT License | `MIT` |
| **Documentation & Guides** | `docs/**` | Creative Commons Attribution 4.0 | `CC-BY-4.0` |

---

## Important Notice for Website & Application Owners

The **VibeUs Client Widget** (`openspec-web/**` and the compiled widget assets listed above) is licensed under the **MIT License**.

- **Embedding the Widget**: Embedding or loading the VibeUs widget in your commercial or proprietary web application does **NOT** require you to release the source code of your website, SaaS, or application.
- **Isolation**: The AGPL-3.0-only license applies to the backend platform (`openspec-core/**`, except the explicitly MIT-licensed compiled widget assets above) and CLI daemon (`openspec-cli/**`), ensuring that modifications to those components remain open-source under AGPL-3.0-only.

The root `LICENSE`, `openspec-core/LICENSE`, and `openspec-cli/LICENSE` contain the full GNU Affero General Public License version 3 text. VibeUs licenses the AGPL-covered components under **version 3 only**, as declared by this component mapping.

For licensing questions or commercial licensing inquiries, contact **contact@vibeus.pro**.
