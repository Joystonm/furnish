/**
 * Three routes and no router dependency.
 *
 * A landing page, a list of the projects in this browser, and the editor. That
 * is one string of path, so a routing library would be a dependency bought to
 * solve a problem the project does not have — and the brief is explicit about
 * not adding what is not needed.
 *
 * Paths, not hashes, because `/studio` is the URL worth putting in a README.
 * Both servers serve `index.html` for an unknown path (Vite's SPA fallback in
 * dev, `app.get('*')` in `server/main.ts`), so a direct visit or a refresh
 * lands on the app rather than a 404.
 */
import { useEffect, useState } from 'react';

export const HOME_PATH = '/';
/** The launcher: every project saved in this browser. */
export const PROJECTS_PATH = '/projects';
/** The editor. Kept at this path so a link to "the studio" keeps meaning it. */
export const STUDIO_PATH = '/studio';

export type Route = 'home' | 'projects' | 'studio';

/** `/studio` and anything under it. */
function isStudio(path: string): boolean {
  return path === STUDIO_PATH || path.startsWith(STUDIO_PATH + '/');
}

function isProjects(path: string): boolean {
  return path === PROJECTS_PATH || path.startsWith(PROJECTS_PATH + '/');
}

/**
 * The current route.
 *
 * `popstate` is dispatched manually by `navigate` below, because
 * `history.pushState` fires no event of its own and without this the back
 * button would change the URL and leave the page showing the other one.
 */
export function useRoute(): Route {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  if (isStudio(path)) return 'studio';
  if (isProjects(path)) return 'projects';
  return 'home';
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}