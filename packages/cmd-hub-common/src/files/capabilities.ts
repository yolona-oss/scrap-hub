import { defineCapability } from '../application/capability'
import type { IFileBackend, IFileMetadataRepo } from './types'

/** Pluggable byte-storage backend (GridFS, S3, …). */
export const CAP_FileBackend = defineCapability<IFileBackend>('common.fileBackend')

/** Metadata persistence keyed by `FileHandle.fileId`. */
export const CAP_FileMetadataRepo = defineCapability<IFileMetadataRepo>('common.fileMetadataRepo')
