import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const phase27 = fs.readFileSync(path.join(ROOT_DIR, 'supabase/phase27_project_chat.sql'), 'utf8');
const store = fs.readFileSync(path.join(ROOT_DIR, 'src/data/store.js'), 'utf8');
const projectChat = fs.readFileSync(path.join(ROOT_DIR, 'src/components/ProjectChat.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Sidebar.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT_DIR, 'src/main.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT_DIR, 'src/styles/index.css'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
const plan = fs.readFileSync(path.join(ROOT_DIR, 'NEXT_PHASE_PLAN.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

[
    'CREATE TABLE IF NOT EXISTS public.project_chat_messages',
    'project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE',
    'body TEXT NOT NULL CHECK',
    'ALTER TABLE public.project_chat_messages ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "Read project chat messages"',
    'CREATE POLICY "Create project chat messages"',
    'TO authenticated',
    'ALTER PUBLICATION supabase_realtime ADD TABLE public.project_chat_messages'
].forEach((needle) => {
    assert.ok(phase27.includes(needle), `phase27 SQL should include ${needle}`);
});

[
    'export async function getProjectChatMessages',
    'export async function sendProjectChatMessage',
    'export function subscribeToProjectChat',
    "project_chat_messages",
    "schemaReady: false"
].forEach((needle) => {
    assert.ok(store.includes(needle), `store should include ${needle}`);
});

[
    'subscribeToProjectChat',
    'sendProjectChatMessage',
    'project-chat-overlay',
    'Request Access',
    'MAX_MESSAGE_LENGTH'
].forEach((needle) => {
    assert.ok(projectChat.includes(needle), `ProjectChat should include ${needle}`);
});

assert.ok(sidebar.includes('btn-project-chat') && sidebar.includes('onProjectChat'), 'Sidebar should wire the project chat action');
assert.ok(main.includes("import('./components/ProjectChat.js')") && main.includes('showProjectChat'), 'main should lazy-load and show ProjectChat');
assert.ok(main.includes('project-chat-fab') && main.includes('collapseSidebarForMapAction'), 'main should expose floating chat and collapse the sidebar for map placement');
assert.ok(main.includes('map-action-banner') && main.includes('hideMapActionBanner'), 'main should show a cancellable map placement banner');
assert.ok(index.includes('btn-project-chat'), 'index should expose the Project Chat sidebar button');
assert.ok(styles.includes('.project-chat-panel') && styles.includes('.project-chat-composer'), 'styles should include the Project Chat drawer');
assert.ok(styles.includes('.project-chat-fab') && styles.includes('#sidebar-expand span'), 'styles should include the floating chat button and mobile sidebar affordance');
assert.ok(styles.includes('.map-action-banner') && styles.includes('.map-action-active .project-chat-fab'), 'styles should include the map placement banner');
assert.ok(readme.includes('supabase/phase27_project_chat.sql'), 'README setup should include Phase 27 migration');
assert.ok(plan.includes('Phase 27 project chat'), 'next phase plan should mention project chat');
assert.ok(pkg.scripts.verify.includes('smoke:project-chat'), 'npm run verify should include the project chat smoke test');

console.log('Project chat smoke check passed.');
