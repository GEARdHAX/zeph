// Landing's scroll container is a custom .overflow-y-auto div, not
// document/window (App.jsx wraps every route in a fixed overflow-hidden
// shell — see Landing/index.jsx) — so native anchor-link scrolling has no
// effect here. Shared by Navbar.jsx and Hero.jsx, both of which link to
// in-page sections.
export default function scrollToSection(event, href) {
  const id = href.replace('#', '');
  const target = document.getElementById(id);
  if (!target) return; // no section yet — let the plain anchor no-op
  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
