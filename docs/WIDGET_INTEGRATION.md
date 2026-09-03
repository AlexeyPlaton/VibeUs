# VibeUs Widget Integration Guide

## 1. Overview
The VibeUs widget is an embeddable client feedback component. It allows your clients, testers, and visitors to leave visual, element-attached feedback, screenshots, and comments directly on your live website without requiring them to register an account.

---

## 2. Canonical Quick Start (Recommended)
Embed VibeUs into any HTML page with a single asynchronous `<script>` tag. The widget automatically mounts to the DOM and initializes itself using data attributes:

```html
<script
  src="https://vibeus.pro/static/vibus-widget.umd.cjs"
  data-project="your-project-slug"
  data-public-key="vb_pub_your_public_key"
  data-server="https://vibeus.pro"
  data-mode="public_feedback"
  async>
</script>
```

> 📋 You can copy this pre-filled script tag directly from your project settings in the **Workspace Dashboard (`/app`)**.

---

## 3. Configuration Data Attributes

| Attribute | Required | Description |
|---|:---:|---|
| `data-project` | **Yes** | The project slug in VibeUs. |
| `data-public-key` | **Yes** | Your project's **Public Widget Key** (`vb_pub_...`). Generated upon project creation and persistent in your dashboard. |
| `data-server` | **Yes** | The URL of your VibeUs instance (`https://vibeus.pro` or your self-hosted domain). |
| `data-mode` | Optional | `public_feedback` (default) \| `studio` \| `client_preview`. |
| `data-theme` | Optional | `auto` (default) \| `dark` \| `light`. |
| `data-accent-color` | Optional | `indigo` \| `emerald` \| `cyan` \| `violet` \| `rose` \| `amber`. |

---

## 4. Security & Origin Verification

1. **Never embed Secret API Tokens in frontend HTML!**  
   The widget only uses the **Public Widget Key** (`data-public-key="vb_pub_..."`). The secret API token (`vb_live_...`) is strictly for CLI, CI/CD, and backend automations.
2. **Allowed Origins**:  
   In your VibeUs project settings, configure the allowed domains (e.g. `https://client-site.com`). The server verifies the HTTP `Origin` header against this list to prevent unauthorized embeds on foreign sites.

---

## 5. Integration Framework Examples

### Vanilla HTML / Webflow / WordPress
Insert the script tag before the closing `</body>` tag of your page template:
```html
<script
  src="https://vibeus.pro/static/vibus-widget.umd.cjs"
  data-project="acme-portal"
  data-public-key="vb_pub_a1b2c3d4e5f6..."
  data-server="https://vibeus.pro"
  data-mode="public_feedback"
  async>
</script>
```

### React / Next.js (App or Pages Router)
Using Next.js `next/script`:
```jsx
import Script from 'next/script';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://vibeus.pro/static/vibus-widget.umd.cjs"
          strategy="lazyOnload"
          data-project="acme-portal"
          data-public-key="vb_pub_a1b2c3d4e5f6..."
          data-server="https://vibeus.pro"
          data-mode="public_feedback"
        />
      </body>
    </html>
  );
}
```

### Vue / Nuxt
```html
<template>
  <div>
    <slot />
  </div>
</template>

<script setup>
useHead({
  script: [
    {
      src: 'https://vibeus.pro/static/vibus-widget.umd.cjs',
      async: true,
      'data-project': 'acme-portal',
      'data-public-key': 'vb_pub_a1b2c3d4e5f6...',
      'data-server': 'https://vibeus.pro',
      'data-mode': 'public_feedback',
    }
  ]
});
</script>
```
