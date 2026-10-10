/* engine/graph.js -- figures registered with what they read.
 *
 * A registry is an ordered list of entries, each { id, label, unit, reads,
 * calc }. `reads` names everything the calculation uses: an input by its path
 * (`d.price`, `loan.rate`, `comps.weighted`, `today`) or another entry by its
 * id. An entry may read only inputs and entries registered before it, so the
 * order is one in which everything can be worked out, and no figure can end
 * up depending on itself. A read may carry a condition, in words, for when it
 * matters: { path: 'd.cap', when: 'only when no price is entered' }. */

const INPUT = /^(d|loan|comps|today)(\.|$)/;

/** Whether a read names an input (rather than another registered entry). */
export const isInput = (path) => INPUT.test(path);

/** A registry; `after` is an earlier registry whose entries this one's may also read. */
export function registry(name, { after = null } = {}) {
  const list = [];
  const byId = new Map();
  const known = (id) => byId.has(id) || !!(after && after.byId.has(id));
  return {
    name,
    list,
    byId,
    /** Register an entry. Throws if the id is taken, or a read names nothing registered before it. */
    add(id, meta, calc) {
      if (byId.has(id)) throw new Error(`${name}: “${id}” is registered twice.`);
      const reads = (meta.reads || []).map((r) => (typeof r === 'string' ? { path: r } : r));
      for (const r of reads) {
        if (!isInput(r.path) && !known(r.path)) {
          throw new Error(`${name}: “${id}” reads “${r.path}”, which isn’t registered before it. An entry can read only inputs and entries above it, so no figure can depend on itself.`);
        }
      }
      const F = { ...meta, id, reads, calc };
      list.push(F);
      byId.set(id, F);
      return F;
    },
  };
}
