const STEP_MS = 110;
const Rail = (props, surface) => {
    const { Box, Text } = surface.elements;
    const ref = surface.state?.ref ?? { phase: 0, active: props.active };
    ref.active = props.active;
    if (surface.state === undefined) {
        surface.setState({ ref });
        surface.every(STEP_MS, () => {
            if (ref.active) {
                ref.phase += 1;
                surface.setState({ ref });
            }
        });
    }
    const width = Math.max(1, surface.columns || props.width);
    const cells = Array.from({ length: width }, () => '─');
    for (const m of props.marks)
        if (m >= 0 && m < width)
            cells[m] = props.isMerge ? '┴' : '┬';
    if (!props.active) {
        return (<Box>
        <Text color={props.dim}>{cells.join('')}</Text>
      </Box>);
    }
    // Two packets per 24 cells, a bright head and a trailing dot, moving left to right.
    const lit = new Map();
    for (let base = 0; base < width + 24; base += 24) {
        const head = (base + ref.phase) % (width + 24);
        if (head < width)
            lit.set(head, '●');
        if (head - 1 >= 0 && head - 1 < width)
            lit.set(head - 1, '•');
    }
    // Runs, not cells: consecutive cells of one kind share a Text, a handful of nodes per frame.
    const runs = [];
    cells.forEach((ch, i) => {
        const isLit = lit.has(i);
        const last = runs[runs.length - 1];
        const glyph = lit.get(i) ?? ch;
        if (last && last.isLit === isLit)
            last.text += glyph;
        else
            runs.push({ text: glyph, isLit });
    });
    return (<Box>
      {runs.map(r => (<Text color={r.isLit ? props.color : props.dim} bold={r.isLit}>
          {r.text}
        </Text>))}
    </Box>);
};
export default Rail;
