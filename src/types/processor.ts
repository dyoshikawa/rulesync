export abstract class Processor {
  protected readonly baseDir: string;

  constructor({ baseDir }: { baseDir: string }) {
    this.baseDir = baseDir;
  }
}
