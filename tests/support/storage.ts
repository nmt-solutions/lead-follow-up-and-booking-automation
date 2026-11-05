import type { StorageObject, PrivateStorage } from "../../src/models/files";

export function createMemoryStorage() {
  const objects = new Map<string, StorageObject>();
  const effects: {
    action: string;
    key: string;
    metadata?: StorageObject["metadata"];
  }[] = [];
  const storage: PrivateStorage & {
    effects: typeof effects;
    objects: typeof objects;
    failPut: boolean;
    failAfterPut: boolean;
    failDelete: boolean;
    failAfterDelete: boolean;
    afterPut: (() => Promise<void>) | null;
    afterGet: (() => Promise<void>) | null;
  } = {
    effects,
    objects,
    failPut: false,
    failAfterPut: false,
    failDelete: false,
    failAfterDelete: false,
    afterPut: null,
    afterGet: null,
    async put(key, object) {
      effects.push({ action: "put", key, metadata: object.metadata });
      if (this.failPut) throw new Error("private-provider-secret");
      objects.set(key, structuredClone(object));
      await this.afterPut?.();
      if (this.failAfterPut) throw new Error("private-provider-timeout");
    },
    async get(key) {
      effects.push({ action: "get", key });
      const value = objects.get(key);
      if (!value) throw new Error("private-provider-missing");
      await this.afterGet?.();
      return structuredClone(value);
    },
    async delete(key) {
      effects.push({ action: "delete", key });
      if (this.failDelete) throw new Error("private-delete-failure");
      objects.delete(key);
      if (this.failAfterDelete)
        throw new Error("private-accepted-delete-timeout");
    },
  };
  return storage;
}
