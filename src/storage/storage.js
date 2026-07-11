export class StorageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StorageError';
    Object.assign(this, details);
  }
}
