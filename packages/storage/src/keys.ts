// Where an object several apps store sits in storage.

export const originalKey = (workspaceId: string, sha256: string) => `workspaces/${workspaceId}/originals/${sha256}`
