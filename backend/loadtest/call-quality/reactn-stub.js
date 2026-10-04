export const getGlobal = () => window.__g;
export const setGlobal = async (patch) => { Object.assign(window.__g, patch); };
