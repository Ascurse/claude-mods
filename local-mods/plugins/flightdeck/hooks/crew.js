export const CREW_SIZE = 5;
export const DEFAULT_CREW = { query: '', isLoading: false, by: null, rows: [], total: 0 };
/** Имя папки навыка: буквы, цифры и дефис как есть, остальное `_hex_`, так что разные агенты не сливаются. */
export const skillDirName = (agent) => {
    const dir = [...agent].map(ch => (/[A-Za-z0-9-]/.test(ch) ? ch : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`)).join('');
    return dir === '' ? '_' : dir;
};
/** SKILL.md: в шапке одна строка описания, целиком оно идёт после шапки. */
export const skillFile = (e) => {
    const firstLine = e.description.split('\n').find(l => l.trim() !== '')?.trim() ?? '';
    return `---\nname: ${skillDirName(e.agent)}\ndescription: ${JSON.stringify(firstLine)}\n---\n${e.description}`;
};
/** Агенты в порядке ответа jev; null, когда ответ нельзя использовать. */
export const parseJevPicks = (stdout, catalog) => {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return null;
    const { status, skills } = parsed;
    if (status !== 'ok' || !Array.isArray(skills))
        return null;
    const byDir = new Map(catalog.map(e => [skillDirName(e.agent), e.agent]));
    const picks = [];
    for (const s of skills) {
        const agent = typeof s?.name === 'string' ? byDir.get(s.name) : undefined;
        if (agent !== undefined && !picks.includes(agent))
            picks.push(agent);
    }
    return picks;
};
const wordsOf = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Запасной отбор: чем больше слов запроса встречается в имени и описании, тем выше; без совпадений — пусто. */
export const wordPicks = (catalog, query, k) => {
    const wanted = [...new Set(wordsOf(query))];
    if (k <= 0 || wanted.length === 0)
        return [];
    return catalog
        .map((e, order) => {
        const have = new Set(wordsOf(`${e.agent} ${e.description}`));
        return { agent: e.agent, order, score: wanted.filter(w => have.has(w)).length };
    })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, k)
        .map(x => x.agent);
};
export const mergePicks = (jev, words, k) => {
    const first = [...new Set(jev ?? [])];
    const by = first.length > 0 ? 'jev' : 'words';
    return { picks: [...new Set([...first, ...words])].slice(0, k), by };
};
export const rowsFor = (picks, catalog) => picks.flatMap(agent => {
    const e = catalog.find(x => x.agent === agent);
    return e ? [{ agent, description: e.description, phase: 'idle', draft: null, error: null }] : [];
});
export const draftRequest = (e, ctx) => ({
    model: 'haiku',
    maxTokens: 600,
    system: 'You write the task prompt for a subagent. Reply with the prompt text only: concrete, self-contained, a few sentences, no preface and no code fences.',
    prompt: `User request:\n${ctx.query}\n\nWorking directory: ${ctx.cwd}\n\nSubagent: ${e.agent}\nWhat it does: ${e.description}\n\nWrite the prompt to give this subagent.`,
});
/** Ответ модели без рамки: обрезка пробелов, ограждение ``` и ведущая метка `Prompt:`. */
export const cleanDraft = (text) => {
    const noLabel = (s) => s.replace(/^prompt:\s*/i, '').trim();
    const noFence = (s) => s.replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1').trim();
    return noLabel(noFence(noLabel(text.trim())));
};
export const setPhase = (crew, agent, phase, patch = {}) => crew.rows.some(r => r.agent === agent)
    ? { ...crew, rows: crew.rows.map(r => (r.agent === agent ? { ...r, ...patch, phase } : r)) }
    : crew;
