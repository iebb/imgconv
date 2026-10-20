export interface Directory {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<Directory>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
      abort?(): Promise<void>;
    }>;
  }>;
}
export async function writeToFolder(
  directory: Directory,
  files: { name: string; folders: string[]; blob: Blob }[],
  progress: (count: number) => void = () => {},
) {
  let count = 0;
  for (const file of files) {
    let target = directory;
    for (const part of file.folders)
      target = await target.getDirectoryHandle(part, { create: true });
    const dot = file.name.lastIndexOf("."),
      base = dot < 0 ? file.name : file.name.slice(0, dot),
      ext = dot < 0 ? "" : file.name.slice(dot);
    let name = file.name,
      n = 2;
    // Leave existing user files intact, even when a prior export used the same names.
    while (true) {
      try {
        await target.getFileHandle(name);
        name = base + "-" + n++ + ext;
      } catch (error) {
        if ((error as DOMException).name === "NotFoundError") break;
        throw error;
      }
    }
    const handle = await target.getFileHandle(name, { create: true }),
      stream = await handle.createWritable();
    try {
      await stream.write(file.blob);
      await stream.close();
    } catch (error) {
      await stream.abort?.();
      throw error;
    }
    progress(++count);
  }
  return count;
}
