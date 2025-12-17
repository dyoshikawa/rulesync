export type FileComparisonStatus = "create" | "update" | "delete" | "unchanged";

export type FileComparisonResult = {
  filePath: string;
  status: FileComparisonStatus;
};

export type CompareAiFilesResult = {
  results: FileComparisonResult[];
  outOfSyncCount: number;
};
