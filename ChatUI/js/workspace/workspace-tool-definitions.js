/**
 * workspace-tool-definitions.js - Gemini-compatible declarations for ChatUI Workspace tools.
 */

const pathDescription = 'Absolute path inside the ChatUI virtual Workspace, starting with /. Only .md files are valid file paths.';

export const WORKSPACE_FUNCTION_DECLARATIONS = [
  {
    name: 'workspace_list_directory',
    description: 'List a Workspace directory without reading file contents. Can recurse through a bounded number of child directory levels.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: pathDescription },
        depth: { type: 'INTEGER', description: 'Directory depth to return. 1 means direct children only. Allowed range 1 to 5.' }
      },
      required: ['path']
    }
  },
  {
    name: 'workspace_read_file',
    description: 'Read raw Markdown text from one Workspace file. Supports bounded 0-based line offset/length reads. A negative offset such as -20 reads the final 20 lines and ignores length.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: pathDescription },
        offset: { type: 'INTEGER', description: '0-based line offset. Negative N reads the final N lines.' },
        length: { type: 'INTEGER', description: 'Number of lines to return for non-negative offsets. Maximum 500.' }
      },
      required: ['path']
    }
  },
  {
    name: 'workspace_read_multiple_files',
    description: 'Read several small related Markdown files in one call. Results remain subject to per-file and total context limits.',
    parameters: {
      type: 'OBJECT',
      properties: {
        paths: { type: 'ARRAY', items: { type: 'STRING' }, description: '1 to 10 absolute .md Workspace paths.' }
      },
      required: ['paths']
    }
  },
  {
    name: 'workspace_write_file',
    description: 'Create/rewrite a Markdown file or append exact Markdown to an existing file. rewrite creates a missing file; append requires the file to already exist and never inserts an automatic newline.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: pathDescription },
        content: { type: 'STRING', description: 'Exact Markdown content to write or append.' },
        mode: { type: 'STRING', enum: ['rewrite', 'append'], description: 'rewrite replaces the whole file; append adds exact content to the end.' }
      },
      required: ['path', 'content', 'mode']
    }
  },
  {
    name: 'workspace_edit_block',
    description: 'Precisely edit an existing Markdown file by literal content matching. The write occurs only when old_string occurs exactly expected_replacements times. Prefer this over rewriting a whole file for small edits.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: pathDescription },
        old_string: { type: 'STRING', description: 'Exact existing text to replace. Include enough surrounding context to make it unambiguous.' },
        new_string: { type: 'STRING', description: 'Exact replacement text.' },
        expected_replacements: { type: 'INTEGER', description: 'Required exact match count before any mutation. Usually 1; allowed range 1 to 100.' }
      },
      required: ['path', 'old_string', 'new_string', 'expected_replacements']
    }
  },
  {
    name: 'workspace_create_directory',
    description: 'Create a Workspace directory using mkdir-p semantics. Missing intermediate directories are created. Existing files in the path cause failure.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Absolute Workspace directory path beginning with /.' } },
      required: ['path']
    }
  },
  {
    name: 'workspace_move',
    description: 'Move or rename one Workspace file or directory. destination is the exact final path, its parent must exist, and existing destinations are not overwritten.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: { type: 'STRING', description: 'Existing absolute Workspace source path.' },
        destination: { type: 'STRING', description: 'Exact final absolute Workspace destination path.' }
      },
      required: ['source', 'destination']
    }
  },
  {
    name: 'workspace_delete_file',
    description: 'Delete one existing Markdown file from Workspace. Missing files return NOT_FOUND.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: pathDescription } },
      required: ['path']
    }
  },
  {
    name: 'workspace_delete_directory',
    description: 'Delete a Workspace directory. recursive defaults false; a non-empty directory is deleted only when recursive is explicitly true. Root / can never be deleted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Absolute non-root Workspace directory path.' },
        recursive: { type: 'BOOLEAN', description: 'Explicitly allow complete subtree deletion when true.' }
      },
      required: ['path']
    }
  },
  {
    name: 'workspace_get_file_info',
    description: 'Get metadata for a Workspace file or directory without reading file content.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Absolute Workspace path.' } },
      required: ['path']
    }
  },
  {
    name: 'workspace_search',
    description: 'Search file/directory names and/or Markdown content within a Workspace directory scope. Content matches include 0-based line indexes and short excerpts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Absolute Workspace directory scope.' },
        query: { type: 'STRING', description: 'Case-insensitive search text.' },
        search_type: { type: 'STRING', enum: ['name', 'content', 'both'], description: 'Where to search.' },
        max_results: { type: 'INTEGER', description: 'Requested result cap. Hard maximum 100.' }
      },
      required: ['path', 'query']
    }
  }
];

export const WORKSPACE_FUNCTION_NAMES = new Set(WORKSPACE_FUNCTION_DECLARATIONS.map(item => item.name));
