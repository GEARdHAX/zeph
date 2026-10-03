import { useEffect } from 'react';

export const SITE_URL = 'https://www.zephchat.tech';

const meta = (attr, key) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
};

const canonicalLink = () => {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  return el;
};

// index.html carries the homepage defaults (all that non-JS crawlers and link
// unfurlers read). This swaps in per-route values for crawlers that do run JS
// and for the browser tab, then restores the defaults on unmount. No dependency.
export function usePageMeta({ title, description, path = '/', noindex = false }) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    const fields = [
      [meta('name', 'description'), 'content', description],
      [canonicalLink(), 'href', url],
      [meta('property', 'og:title'), 'content', title],
      [meta('property', 'og:description'), 'content', description],
      [meta('property', 'og:url'), 'content', url],
      [meta('name', 'twitter:title'), 'content', title],
      [meta('name', 'twitter:description'), 'content', description],
      [meta('name', 'robots'), 'content', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'],
    ];
    const previousTitle = document.title;
    const previous = fields.map(([el, attr]) => el.getAttribute(attr));
    document.title = title;
    fields.forEach(([el, attr, value]) => el.setAttribute(attr, value));
    return () => {
      document.title = previousTitle;
      fields.forEach(([el, attr], i) => {
        if (previous[i] === null) el.removeAttribute(attr);
        else el.setAttribute(attr, previous[i]);
      });
    };
  }, [title, description, path, noindex]);
}
