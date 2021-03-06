import type { TextFile } from './files/TextFile';

export class Tree {
    constructor(
        public name: string,
        public path: string,
        private _title?: string,
        public file?: TextFile,
        public children: Tree[] = []
    ) {
        this._title = this._title ?? this.name;
    }

    public get hasChildren() {
        return this.children?.length > 0;
    }

    public add(path: string, file?: TextFile) {
        const parts = path.split(/[\\\/]/);
        let node = this as any as Tree;
        const filename = parts.pop();
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const partPath = parts.slice(0, i + 1).join('/');
            const search = node.children.find(x => x.name === part);
            if (search) {
                node = search;
            } else {
                const newNode = new Tree(part, partPath, part);
                node.children.push(newNode);
                node = newNode;
            }
        }
        //now that we have the parent node, push the file
        node.children.push(
            new Tree(filename, path, file?.title ?? filename, file)
        );
    }

    /**
     * Sort the tree recursively. Leafs are sorted to the top and then alphabetized, then branches are alphatized next (at the bottom)
     */
    public sort() {
        const nodes = [this] as Tree[];
        while (nodes.length > 0) {
            const node = nodes.pop();
            nodes.push(...node.children ?? []);

            //sort the children of this node
            node.children.sort((a, b) => {
                let aPriority = this.getPriority(a) ?? 1000;
                let bPriority = this.getPriority(b) ?? 1000;

                //sort by file priority
                if (aPriority > bPriority) {
                    return 1;
                } else if (bPriority > aPriority) {
                    return -1;
                }

                //now sort by name
                return a.name.localeCompare(b.name);
            });
        }
        return this;
    }

    /**
     * Given a node, find its priority. If the node doesn't have a priority, look through its direct children for a `parentPriority` attribute
     */
    private getPriority(node: Tree) {
        if (!node.hasChildren) {
            return node.file?.attributes.priority;
        }
        for (const child of node.children) {
            const priorityFromChild = child.file?.attributes.parentPriority;
            if (priorityFromChild) {
                return priorityFromChild;
            }
        }
    }

    /**
     * Given a node, find its priority. If the node doesn't have a priority, look through its direct children for a `parentPriority` attribute
     */
    public get title() {
        if (this.hasChildren) {
            for (const child of this.children) {
                const titleFromChild = child.file?.attributes.parentTitle;
                if (titleFromChild) {
                    return titleFromChild;
                }
            }
        }
        return this.file?.attributes.title ?? this._title;
    }
}

export enum SortMode {

}
