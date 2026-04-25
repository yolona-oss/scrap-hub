export type FlattenedPaths<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${FlattenedPaths<T[K]>}`
          : `${K}`
        : never
    }[keyof T]
  : never

export type FlattenedPathsWithTypes<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? { path: `${K}.${FlattenedPathsWithTypes<T[K]>["path"]}`; type: FlattenedPathsWithTypes<T[K]>["type"] }
          : { path: `${K}`; type: T[K] }
        : never
    }[keyof T]
  : never

export function getInterfacePaths<T>(obj: T): string[] {
    const paths: string[] = []

    function traverse(currentObj: any, currentPath: string = "") {
        for (const key in currentObj) {
            if (typeof currentObj[key] === "object" && currentObj[key] !== null) {
                traverse(currentObj[key], `${currentPath}${key}.`)
            } else {
                paths.push(`${currentPath}${key}`)
            }
        }
    }

    traverse(obj)
    return paths
}

export function getInterfacePathsWithTypes<T>(obj: T): Array<{ path: string; type: any }> {
    const result: Array<{ path: string; type: any }> = []

    function traverse(currentObj: any, currentPath: string = "") {
        for (const key in currentObj) {
            const fullPath = currentPath ? `${currentPath}.${key}` : key
            if (typeof currentObj[key] === "object" && currentObj[key] !== null) {
                traverse(currentObj[key], fullPath)
            } else {
                result.push({ path: fullPath, type: (typeof currentObj[key]).toLowerCase() })
            }
        }
    }

    traverse(obj)
    return result
}
