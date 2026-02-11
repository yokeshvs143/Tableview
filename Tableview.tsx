import { ReactElement, createElement, useState, useCallback, useEffect, useRef } from "react";

import classNames from "classnames";
import { TableviewContainerProps } from "../typings/TableviewProps";
import Big from "big.js";
import "./ui/Tableview.css";

// Simplified cell object with new JSON format
interface CellObject {
    id: string;
    sequenceNumber: string;
    isBlocked: boolean;
    isMerged: boolean;
    mergeId: string;
   
    // Internal properties (not exported)
    rowIndex: number;      // 1-based
    columnIndex: number;   // 1-based
    checked: boolean;
    isSelected: boolean;
    rowSpan: number;
    colSpan: number;
    isHidden: boolean;
}

// Row structure containing cell objects
interface TableRow {
    id: string;
    rowIndex: number;  // 1-based
    cells: CellObject[];
}

// Complete table data structure
interface TableData {
    rows: number;
    columns: number;
    tableRows: TableRow[];
    metadata?: {
        createdAt?: string;
        updatedAt?: string;
    };
}

// Main component
const Tableview = (props: TableviewContainerProps): ReactElement => {
    // Get initial values from attributes or use defaults
    const getInitialRows = () => {
        if (props.rowCountAttribute?.status === "available" && props.rowCountAttribute.value) {
            return Number(props.rowCountAttribute.value);
        }
        return 3; // Default fallback
    };
   
    const getInitialColumns = () => {
        if (props.columnCountAttribute?.status === "available" && props.columnCountAttribute.value) {
            return Number(props.columnCountAttribute.value);
        }
        return 3; // Default fallback
    };
   
    // Actual row and column counts
    const [rowCount, setRowCount] = useState<number>(getInitialRows());
    const [columnCount, setColumnCount] = useState<number>(getInitialColumns());
   
    // Table data
    const [tableRows, setTableRows] = useState<TableRow[]>([]);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
    
    // Drag selection state
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStartCell, setDragStartCell] = useState<{row: number, col: number} | null>(null);
    const dragSelectionRef = useRef<Set<string>>(new Set());
    const preSelectionRef = useRef<Set<string>>(new Set()); // Store selection before drag
   
    // Track if this is initial load to prevent unwanted regeneration
    const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [dataLoaded, setDataLoaded] = useState<boolean>(false);
    const lastSavedDataRef = useRef<string>("");
    
    // Flags to prevent circular updates
    const isUserInputRef = useRef<boolean>(false);
    const ignoreAttributeUpdateRef = useRef<boolean>(false);

    // Update cell statistics to attributes
    const updateCellStatistics = useCallback((rows: TableRow[]) => {
        const totalCells = rows.reduce((sum, row) => sum + row.cells.length, 0);
        const blockedCells = rows.reduce((sum, row) => sum + row.cells.filter(c => c.isBlocked).length, 0);
        const mergedCells = rows.reduce((sum, row) => sum + row.cells.filter(c => c.isMerged && !c.isHidden).length, 0);
       
        if (props.totalCellsAttribute?.status === "available") {
            props.totalCellsAttribute.setValue(new Big(totalCells));
        }
       
        if (props.blockedCellsAttribute?.status === "available") {
            props.blockedCellsAttribute.setValue(new Big(blockedCells));
        }
       
        if (props.mergedCellsAttribute?.status === "available") {
            props.mergedCellsAttribute.setValue(new Big(mergedCells));
        }
    }, [props.totalCellsAttribute, props.blockedCellsAttribute, props.mergedCellsAttribute]);

    // Load from useAttributeData - RUNS FIRST, before initialization
    useEffect(() => {
        // Don't reload if we're currently saving (prevents circular updates)
        if (isSaving) {
            return;
        }
       
        const incomingData = props.useAttributeData?.value || "";
       
        // Don't reload if this is the same data we just saved
        if (incomingData === lastSavedDataRef.current && lastSavedDataRef.current !== "") {
            return;
        }
       
        if (incomingData && incomingData !== "") {
            try {
                const tableData: TableData = JSON.parse(incomingData);
                if (tableData.tableRows && tableData.rows > 0 && tableData.columns > 0) {
                    // Validate and sanitize loaded data
                    const validatedRows = tableData.tableRows.map((row, idx) => {
                        const rowIndex = idx + 1;
                        return {
                            ...row,
                            id: `row_${rowIndex}`,
                            rowIndex: rowIndex,
                            cells: row.cells.map((cell, cIdx) => {
                                const colIndex = cIdx + 1;
                                const seqNum = cell.sequenceNumber || "-";
                                // Only blocked if value is NOT "-" and NOT empty
                                const isBlocked = seqNum.trim() !== "" && seqNum.trim() !== "-";
                                const validatedCell: CellObject = {
                                    id: `cell_${rowIndex}_${colIndex}`,
                                    sequenceNumber: seqNum,
                                    isBlocked: cell.isBlocked !== undefined ? cell.isBlocked : isBlocked,
                                    isMerged: cell.isMerged || false,
                                    mergeId: cell.mergeId || "",
                                    rowIndex: rowIndex,
                                    columnIndex: colIndex,
                                    checked: cell.checked || false,
                                    isSelected: false,
                                    rowSpan: cell.rowSpan || 1,
                                    colSpan: cell.colSpan || 1,
                                    isHidden: cell.isHidden || false
                                };
                                return validatedCell;
                            })
                        };
                    });
                   
                    // IMPORTANT: Update row and column counts from loaded data
                    setRowCount(tableData.rows);
                    setColumnCount(tableData.columns);
                    
                    // Update attributes to match loaded data
                    ignoreAttributeUpdateRef.current = true;
                    if (props.rowCountAttribute?.status === "available") {
                        props.rowCountAttribute.setValue(new Big(tableData.rows));
                    }
                    if (props.columnCountAttribute?.status === "available") {
                        props.columnCountAttribute.setValue(new Big(tableData.columns));
                    }
                    
                    setTableRows(validatedRows);
                    setSelectedCells(new Set());
                    setIsSelectionMode(false);
                    setDataLoaded(true);
                   
                    // Update cell statistics
                    updateCellStatistics(validatedRows);
                   
                    // Update last loaded data reference
                    lastSavedDataRef.current = incomingData;
                   
                    // Mark initial load as complete after a short delay
                    if (isInitialLoad) {
                        setTimeout(() => setIsInitialLoad(false), 500);
                    }
                }
            } catch (error) {
                console.error("Error loading table from attribute:", error);
                // Mark initial load as complete even on error
                if (isInitialLoad) {
                    setTimeout(() => setIsInitialLoad(false), 500);
                }
            }
        } else {
            // No data to load, mark initial load as complete
            if (isInitialLoad) {
                setTimeout(() => setIsInitialLoad(false), 500);
            }
        }
    }, [props.useAttributeData?.value, updateCellStatistics, isSaving, isInitialLoad, props.rowCountAttribute, props.columnCountAttribute]);

    // Sync with row attribute - Allow updates from external sources
    useEffect(() => {
        if (ignoreAttributeUpdateRef.current) {
            ignoreAttributeUpdateRef.current = false;
            return;
        }
        
        if (props.rowCountAttribute?.status === "available" && props.rowCountAttribute.value != null) {
            const attrValue = Number(props.rowCountAttribute.value);
            if (!isNaN(attrValue) && attrValue > 0 && attrValue <= 100) {
                // Only update if the value actually changed from outside
                if (attrValue !== rowCount && !isUserInputRef.current) {
                    setRowCount(attrValue);
                }
            }
        }
    }, [props.rowCountAttribute?.value, rowCount]);

    // Sync with column attribute - Allow updates from external sources
    useEffect(() => {
        if (ignoreAttributeUpdateRef.current) {
            ignoreAttributeUpdateRef.current = false;
            return;
        }
        
        if (props.columnCountAttribute?.status === "available" && props.columnCountAttribute.value != null) {
            const attrValue = Number(props.columnCountAttribute.value);
            if (!isNaN(attrValue) && attrValue > 0 && attrValue <= 100) {
                // Only update if the value actually changed from outside
                if (attrValue !== columnCount && !isUserInputRef.current) {
                    setColumnCount(attrValue);
                }
            }
        }
    }, [props.columnCountAttribute?.value, columnCount]);

    // Create merge ID from positions (1-based)
    const createMergeId = (rowStart: number, colStart: number, rowEnd: number, colEnd: number): string => {
        return `${rowStart}${colStart}${rowEnd}${colEnd}`;
    };

    // Create new table with cell objects - ALWAYS starts with unblocked cells (1-based indexing)
    const createNewTable = useCallback((rows: number, cols: number) => {
        if (rows <= 0 || cols <= 0) return;
       
        const newTableRows: TableRow[] = Array.from({ length: rows }, (_, idx) => {
            const rowIndex = idx + 1; // 1-based
            return {
                id: `row_${rowIndex}`,
                rowIndex: rowIndex,
                cells: Array.from({ length: cols }, (_, cIdx) => {
                    const colIndex = cIdx + 1; // 1-based
                    const cell: CellObject = {
                        id: `cell_${rowIndex}_${colIndex}`,
                        sequenceNumber: "-",
                        isBlocked: false,
                        isMerged: false,
                        mergeId: "",
                        rowIndex: rowIndex,
                        columnIndex: colIndex,
                        checked: false,
                        isSelected: false,
                        rowSpan: 1,
                        colSpan: 1,
                        isHidden: false
                    };
                   
                    return cell;
                })
            };
        });
       
        setTableRows(newTableRows);
        setSelectedCells(new Set());
        setIsSelectionMode(false);
        setDataLoaded(true);
       
        // Save to backend
        saveToBackend(newTableRows, rows, cols);
    }, []);

    // Initialize table only if no data was loaded
    useEffect(() => {
        // Wait a bit to ensure the load effect has run
        const timer = setTimeout(() => {
            if (!dataLoaded && tableRows.length === 0) {
                createNewTable(rowCount, columnCount);
            }
        }, 100);
       
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataLoaded]); // Only depends on dataLoaded flag

    // Save to backend (always keeps backend in sync)
    const saveToBackend = useCallback((rows: TableRow[], rowCnt: number, colCnt: number) => {
        setIsSaving(true);
       
        const tableData: TableData = {
            rows: rowCnt,
            columns: colCnt,
            tableRows: rows,
            metadata: {
                updatedAt: new Date().toISOString()
            }
        };

        const jsonData = JSON.stringify(tableData);
        lastSavedDataRef.current = jsonData;

        // Save to primary attribute
        if (props.useAttributeData?.status === "available") {
            props.useAttributeData.setValue(jsonData);
        }

        // Also save to secondary attribute if configured
        if (props.tableDataAttribute?.status === "available") {
            props.tableDataAttribute.setValue(jsonData);
        }

        // Save row/column counts to attributes - with flag to prevent circular update
        ignoreAttributeUpdateRef.current = true;
        if (props.rowCountAttribute?.status === "available") {
            props.rowCountAttribute.setValue(new Big(rowCnt));
        }
       
        if (props.columnCountAttribute?.status === "available") {
            props.columnCountAttribute.setValue(new Big(colCnt));
        }
       
        // Update cell statistics
        updateCellStatistics(rows);

        // Trigger change event
        if (props.onTableChange?.canExecute) {
            props.onTableChange.execute();
        }
       
        // Reset saving flag after a short delay
        setTimeout(() => setIsSaving(false), 100);
    }, [props.useAttributeData, props.tableDataAttribute, props.rowCountAttribute, props.columnCountAttribute, props.onTableChange, updateCellStatistics]);

    // Auto-save when table data changes
    useEffect(() => {
        if (props.autoSave && tableRows.length > 0 && !isSaving) {
            saveToBackend(tableRows, rowCount, columnCount);
        }
    }, [tableRows, props.autoSave, saveToBackend, isSaving, rowCount, columnCount]);

    // Always update statistics when table changes (even if auto-save is off)
    useEffect(() => {
        if (tableRows.length > 0) {
            updateCellStatistics(tableRows);
        }
    }, [tableRows, updateCellStatistics]);

    // Apply row/column changes and regenerate table
    const applyDimensions = useCallback(() => {
        const newRows = rowCount;
        const newCols = columnCount;

        if (isNaN(newRows) || isNaN(newCols)) {
            alert("Please enter valid numbers");
            return;
        }

        if (newRows <= 0 || newCols <= 0) {
            alert("Rows and columns must be positive numbers");
            return;
        }

        if (newRows > 100 || newCols > 100) {
            alert("Maximum 100 rows and 100 columns");
            return;
        }
       
        // Mark that we're updating from user action
        ignoreAttributeUpdateRef.current = true;
       
        // Save to attributes if configured
        if (props.rowCountAttribute?.status === "available") {
            props.rowCountAttribute.setValue(new Big(newRows));
        }
       
        if (props.columnCountAttribute?.status === "available") {
            props.columnCountAttribute.setValue(new Big(newCols));
        }
       
        createNewTable(newRows, newCols);
    }, [rowCount, columnCount, createNewTable, props.rowCountAttribute, props.columnCountAttribute]);

    // Add single row - preserves existing data
    const addRow = useCallback(() => {
        const newRowCount = rowCount + 1;
        if (newRowCount > 100) {
            alert("Maximum 100 rows");
            return;
        }
       
        isUserInputRef.current = true;
        setRowCount(newRowCount);
       
        ignoreAttributeUpdateRef.current = true;
        if (props.rowCountAttribute?.status === "available") {
            props.rowCountAttribute.setValue(new Big(newRowCount));
        }
       
        // Add a new row to existing table instead of regenerating
        setTableRows(prevRows => {
            const newRows = [...prevRows];
            const rowIndex = newRowCount;
           
            // Create new row with empty cells
            const newRow: TableRow = {
                id: `row_${rowIndex}`,
                rowIndex: rowIndex,
                cells: Array.from({ length: columnCount }, (_, cIdx) => {
                    const colIndex = cIdx + 1;
                    return {
                        id: `cell_${rowIndex}_${colIndex}`,
                        sequenceNumber: "-",
                        isBlocked: false,
                        isMerged: false,
                        mergeId: "",
                        rowIndex: rowIndex,
                        columnIndex: colIndex,
                        checked: false,
                        isSelected: false,
                        rowSpan: 1,
                        colSpan: 1,
                        isHidden: false
                    };
                })
            };
           
            newRows.push(newRow);
           
            // Save to backend
            saveToBackend(newRows, newRowCount, columnCount);
           
            return newRows;
        });
        
        setTimeout(() => {
            isUserInputRef.current = false;
        }, 100);
    }, [rowCount, columnCount, props.rowCountAttribute, saveToBackend]);

    // Add single column - preserves existing data
    const addColumn = useCallback(() => {
        const newColCount = columnCount + 1;
        if (newColCount > 100) {
            alert("Maximum 100 columns");
            return;
        }
       
        isUserInputRef.current = true;
        setColumnCount(newColCount);
       
        ignoreAttributeUpdateRef.current = true;
        if (props.columnCountAttribute?.status === "available") {
            props.columnCountAttribute.setValue(new Big(newColCount));
        }
       
        // Add a new column to existing table instead of regenerating
        setTableRows(prevRows => {
            const newRows = prevRows.map(row => {
                const colIndex = newColCount;
               
                // Create new cell for this row
                const newCell: CellObject = {
                    id: `cell_${row.rowIndex}_${colIndex}`,
                    sequenceNumber: "-",
                    isBlocked: false,
                    isMerged: false,
                    mergeId: "",
                    rowIndex: row.rowIndex,
                    columnIndex: colIndex,
                    checked: false,
                    isSelected: false,
                    rowSpan: 1,
                    colSpan: 1,
                    isHidden: false
                };
               
                return {
                    ...row,
                    cells: [...row.cells, newCell]
                };
            });
           
            // Save to backend
            saveToBackend(newRows, rowCount, newColCount);
           
            return newRows;
        });
        
        setTimeout(() => {
            isUserInputRef.current = false;
        }, 100);
    }, [rowCount, columnCount, props.columnCountAttribute, saveToBackend]);

    // Handle cell value change
    const handleCellValueChange = useCallback((rowIndex: number, colIndex: number, newValue: string) => {
        setTableRows(prevRows => {
            const newRows = prevRows.map(row => ({
                ...row,
                cells: row.cells.map(cell => ({ ...cell }))
            }));

            const targetCell = newRows.find(r => r.rowIndex === rowIndex)?.cells.find(c => c.columnIndex === colIndex);
            if (!targetCell) return prevRows;

            targetCell.sequenceNumber = newValue;
           
            // Only mark as blocked if value is NOT "-" and NOT empty
            const isBlocked = newValue.trim() !== "" && newValue.trim() !== "-";
            targetCell.isBlocked = isBlocked;
            targetCell.isSelected = isBlocked;
           
            if (targetCell.mergeId && targetCell.mergeId !== "") {
                const mergeId = targetCell.mergeId;
                newRows.forEach(row => {
                    row.cells.forEach(cell => {
                        if (cell.mergeId === mergeId) {
                            cell.sequenceNumber = newValue;
                            cell.isBlocked = isBlocked;
                            cell.isSelected = isBlocked;
                        }
                    });
                });
            }

            // Update statistics immediately
            updateCellStatistics(newRows);
            
            // Save to backend if auto-save is enabled
            if (props.autoSave) {
                saveToBackend(newRows, rowCount, columnCount);
            }

            return newRows;
        });

        if (props.onCellClick?.canExecute) {
            props.onCellClick.execute();
        }
    }, [props.onCellClick, props.autoSave, updateCellStatistics, saveToBackend, rowCount, columnCount]);

    // Handle checkbox change
    const handleCheckboxChange = useCallback((rowIndex: number, colIndex: number) => {
        setTableRows(prevRows => {
            const newRows = prevRows.map(row => ({
                ...row,
                cells: row.cells.map(cell => ({ ...cell }))
            }));

            const targetCell = newRows.find(r => r.rowIndex === rowIndex)?.cells.find(c => c.columnIndex === colIndex);
            if (!targetCell) return prevRows;

            const newCheckedState = !targetCell.checked;
            targetCell.checked = newCheckedState;
           
            if (targetCell.mergeId && targetCell.mergeId !== "") {
                const mergeId = targetCell.mergeId;
                newRows.forEach(row => {
                    row.cells.forEach(cell => {
                        if (cell.mergeId === mergeId) {
                            cell.checked = newCheckedState;
                        }
                    });
                });
            }

            return newRows;
        });

        if (props.onCellClick?.canExecute) {
            props.onCellClick.execute();
        }
    }, [props.onCellClick]);

    // Get rectangular selection between two cells
    const getRectangularSelection = useCallback((startRow: number, startCol: number, endRow: number, endCol: number): Set<string> => {
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);
        
        const selection = new Set<string>();
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                selection.add(`cell_${r}_${c}`);
            }
        }
        return selection;
    }, []);

    // Handle cell mouse down - start drag selection
    const handleCellMouseDown = useCallback((rowIndex: number, colIndex: number, event: React.MouseEvent) => {
        // Don't start drag on input or checkbox
        if ((event.target as HTMLElement).tagName === 'INPUT') {
            return;
        }
        
        event.preventDefault();
        
        // Store current selection before starting drag
        preSelectionRef.current = new Set(selectedCells);
        
        setIsDragging(true);
        setDragStartCell({ row: rowIndex, col: colIndex });
        setIsSelectionMode(true);
        
        const cellId = `cell_${rowIndex}_${colIndex}`;
        
        // Check if Shift key is pressed for additive drag selection
        const isShiftPressed = event.shiftKey;
        
        if (isShiftPressed) {
            // Shift + Drag: Add to existing selection
            dragSelectionRef.current = new Set([cellId]);
            const newSelection = new Set(selectedCells);
            newSelection.add(cellId);
            setSelectedCells(newSelection);
        } else {
            // Normal drag: Start fresh selection
            dragSelectionRef.current = new Set([cellId]);
            setSelectedCells(new Set([cellId]));
        }
    }, [selectedCells]);

    // Handle cell mouse enter - update drag selection
    const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
        if (!isDragging || !dragStartCell) return;
        
        const draggedSelection = getRectangularSelection(
            dragStartCell.row,
            dragStartCell.col,
            rowIndex,
            colIndex
        );
        
        dragSelectionRef.current = draggedSelection;
        
        // Combine pre-selection with dragged selection if Shift was held
        const finalSelection = new Set(preSelectionRef.current);
        draggedSelection.forEach(cell => finalSelection.add(cell));
        
        setSelectedCells(finalSelection);
    }, [isDragging, dragStartCell, getRectangularSelection]);

    // Handle mouse up - end drag selection
    useEffect(() => {
        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                setDragStartCell(null);
                preSelectionRef.current = new Set();
            }
        };
        
        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, [isDragging]);

    // Handle cell click for selection mode (when not dragging) - NATURAL MULTI-SELECT
    const handleCellClick = useCallback((rowIndex: number, colIndex: number, event?: React.MouseEvent) => {
        if (isDragging) return; // Ignore clicks during drag
        
        const cellId = `cell_${rowIndex}_${colIndex}`;
       
        if (props.onCellClick?.canExecute) {
            props.onCellClick.execute();
        }

        // Check for modifier keys
        const isCtrlOrCmd = event?.ctrlKey || event?.metaKey;

        if (isSelectionMode) {
            setSelectedCells(prev => {
                const newSet = new Set(prev);
                
                if (isCtrlOrCmd) {
                    // Ctrl/Cmd + Click: Toggle/deselect individual cell
                    if (newSet.has(cellId)) {
                        // Only allow deselection if there are multiple cells selected
                        if (newSet.size > 1) {
                            newSet.delete(cellId);
                        }
                    } else {
                        newSet.add(cellId);
                    }
                } else {
                    // Normal click: Add to selection (accumulative by default)
                    if (newSet.has(cellId) && newSet.size === 1) {
                        // If clicking the only selected cell, keep it selected
                        return newSet;
                    } else {
                        // Add to existing selection
                        newSet.add(cellId);
                    }
                }
                
                return newSet;
            });
        } else {
            // First click - start selection mode
            setSelectedCells(new Set([cellId]));
            setIsSelectionMode(true);
        }
    }, [isSelectionMode, isDragging, props.onCellClick]);

    // Select all cells
    const selectAllCells = useCallback(() => {
        const allCells = new Set<string>();
        tableRows.forEach(row => {
            row.cells.forEach(cell => {
                if (!cell.isHidden) {
                    allCells.add(cell.id);
                }
            });
        });
        setSelectedCells(allCells);
        setIsSelectionMode(true);
    }, [tableRows]);

    // Merge selected cells
    const mergeCells = useCallback(() => {
        if (selectedCells.size < 2) return;

        const cellPositions = Array.from(selectedCells).map(id => {
            const parts = id.replace('cell_', '').split('_');
            return { row: parseInt(parts[0]), col: parseInt(parts[1]) };
        });

        const minRow = Math.min(...cellPositions.map(p => p.row));
        const maxRow = Math.max(...cellPositions.map(p => p.row));
        const minCol = Math.min(...cellPositions.map(p => p.col));
        const maxCol = Math.max(...cellPositions.map(p => p.col));

        const expectedCells = (maxRow - minRow + 1) * (maxCol - minCol + 1);
        if (selectedCells.size !== expectedCells) {
            alert("Please select a rectangular area to merge");
            return;
        }

        setTableRows(prevRows => {
            const newRows = prevRows.map(row => ({
                ...row,
                cells: row.cells.map(cell => ({ ...cell }))
            }));

            // Unmerge existing merges in selection
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    const cell = newRows.find(row => row.rowIndex === r)?.cells.find(cl => cl.columnIndex === c);
                    if (cell && cell.isMerged && cell.mergeId && cell.mergeId !== "") {
                        const oldMergeId = cell.mergeId;
                        newRows.forEach(row => {
                            row.cells.forEach(c => {
                                if (c.mergeId === oldMergeId) {
                                    c.isMerged = false;
                                    c.rowSpan = 1;
                                    c.colSpan = 1;
                                    c.isHidden = false;
                                    c.mergeId = "";
                                }
                            });
                        });
                    }
                }
            }

            const mergeId = createMergeId(minRow, minCol, maxRow, maxCol);
            const topLeftCell = newRows.find(r => r.rowIndex === minRow)?.cells.find(c => c.columnIndex === minCol);
           
            if (!topLeftCell) return prevRows;
           
            const mergedValue = topLeftCell.sequenceNumber;
            const mergedChecked = topLeftCell.checked;
            const mergedIsBlocked = topLeftCell.isBlocked;
           
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    const cell = newRows.find(row => row.rowIndex === r)?.cells.find(cl => cl.columnIndex === c);
                    if (!cell) continue;
                   
                    cell.sequenceNumber = mergedValue;
                    cell.checked = mergedChecked;
                    cell.isBlocked = mergedIsBlocked;
                    cell.isSelected = mergedIsBlocked;
                    cell.isMerged = true;
                    cell.mergeId = mergeId;
                   
                    if (r === minRow && c === minCol) {
                        cell.rowSpan = maxRow - minRow + 1;
                        cell.colSpan = maxCol - minCol + 1;
                        cell.isHidden = false;
                    } else {
                        cell.rowSpan = 1;
                        cell.colSpan = 1;
                        cell.isHidden = true;
                    }
                }
            }

            // Update statistics and save
            updateCellStatistics(newRows);
            saveToBackend(newRows, rowCount, columnCount);

            return newRows;
        });

        // Keep the merged cell selected
        const mergedCellId = `cell_${minRow}_${minCol}`;
        setSelectedCells(new Set([mergedCellId]));
        // Keep selection mode active
    }, [selectedCells, updateCellStatistics, saveToBackend, rowCount, columnCount]);

    // Unmerge cells
    const unmergeCells = useCallback(() => {
        if (selectedCells.size === 0) return;

        const cellId = Array.from(selectedCells)[0];
        const parts = cellId.replace('cell_', '').split('_');
        const rowIndex = parseInt(parts[0]);
        const cellIndex = parseInt(parts[1]);

        setTableRows(prevRows => {
            const newRows = prevRows.map(row => ({
                ...row,
                cells: row.cells.map(cell => ({ ...cell }))
            }));

            const targetCell = newRows.find(r => r.rowIndex === rowIndex)?.cells.find(c => c.columnIndex === cellIndex);
            if (!targetCell || !targetCell.isMerged) return prevRows;

            const mergeId = targetCell.mergeId;

            newRows.forEach(row => {
                row.cells.forEach(cell => {
                    if (cell.mergeId === mergeId) {
                        cell.isMerged = false;
                        cell.rowSpan = 1;
                        cell.colSpan = 1;
                        cell.isHidden = false;
                        cell.mergeId = "";
                    }
                });
            });

            // Update statistics and save
            updateCellStatistics(newRows);
            saveToBackend(newRows, rowCount, columnCount);

            return newRows;
        });

        // Keep the first cell selected after unmerge
        // Don't clear selection or mode
    }, [selectedCells, updateCellStatistics, saveToBackend, rowCount, columnCount]);

    // Styling
    const tableStyle = {
        borderColor: props.tableBorderColor || '#dee2e6'
    };

    const selectedCellStyle = {
        backgroundColor: props.selectedCellColor || '#cfe2ff'
    };

    const mergedCellStyle = {
        backgroundColor: props.mergedCellColor || '#e3f2fd',
        borderColor: '#2196f3'
    };

    const blockedCellStyle = {
        backgroundColor: 'white',
        borderColor: '#fdd835'
    };

    return (
        <div className={classNames("tableview-container", props.class)} style={props.style}>
            {/* Unified Controls Container - All controls in one white box */}
            <div className="tableview-controls">
                {/* Generate Table Button - Only shown if enabled */}
                {props.showGenerateButton && (
                    <button
                        className="tableview-btn tableview-btn-primary"
                        onClick={applyDimensions}
                    >
                        Generate Table
                    </button>
                )}

                {/* Merge Actions - Same container, conditionally shown */}
                {props.enableCellMerging && selectedCells.size > 0 && (
                    createElement('div', { style: { display: 'contents' } },
                        createElement('div', { className: 'tableview-controls-divider' }),
                        createElement('p', { className: 'tableview-selection-info' },
                            `${selectedCells.size} cell(s) selected`
                        ),
                        createElement('button', {
                            className: 'tableview-btn tableview-btn-info',
                            onClick: selectAllCells,
                            title: 'Select all cells'
                        }, 'Select All'),
                        createElement('button', {
                            className: 'tableview-btn tableview-btn-warning',
                            onClick: mergeCells,
                            disabled: selectedCells.size < 2
                        }, 'Merge Selected'),
                        createElement('button', {
                            className: 'tableview-btn tableview-btn-danger',
                            onClick: unmergeCells
                        }, 'Unmerge'),
                        createElement('button', {
                            className: 'tableview-btn tableview-btn-secondary',
                            onClick: () => {
                                setSelectedCells(new Set());
                                setIsSelectionMode(false);
                            }
                        }, 'Clear Selection')
                    )
                )}
            </div>

            {/* Table */}
            <div className="tableview-table-section">
                {/* Add Column Button - Top */}
                {props.showAddColumnButton && (
                    <div className="tableview-add-column-container">
                        <button
                            className="tableview-btn tableview-btn-add"
                            onClick={addColumn}
                            title="Add Column"
                        >
                            +
                        </button>
                    </div>
                )}
               
                <div className="tableview-table-row-wrapper">
                    {/* Add Row Button - Left */}
                    {props.showAddRowButton && (
                        <div className="tableview-add-row-container">
                            <button
                                className="tableview-btn tableview-btn-add"
                                onClick={addRow}
                                title="Add Row"
                            >
                                +
                            </button>
                        </div>
                    )}
                   
                    {/* Table Wrapper */}
                    <div 
                        className="tableview-table-wrapper"
                        style={{ userSelect: isDragging ? 'none' : 'auto' }}
                    >
                        <table
                            className="tableview-table"
                            style={tableStyle}
                            data-rows={rowCount}
                            data-cols={columnCount}
                        >
                    <tbody>
                        {tableRows.map((row) => (
                            <tr key={row.id}>
                                {row.cells.map((cell) => {
                                    if (cell.isHidden) return null;

                                    const isSelected = selectedCells.has(cell.id);

                                    return (
                                        <td
                                            key={cell.id}
                                            rowSpan={cell.rowSpan}
                                            colSpan={cell.colSpan}
                                            className={classNames("tableview-cell", {
                                                "tableview-cell-merged": cell.isMerged,
                                                "tableview-cell-selected": isSelected,
                                                "tableview-cell-blocked": cell.isBlocked,
                                                "tableview-cell-dragging": isDragging
                                            })}
                                            onClick={(e) => handleCellClick(cell.rowIndex, cell.columnIndex, e)}
                                            onMouseDown={(e) => handleCellMouseDown(cell.rowIndex, cell.columnIndex, e)}
                                            onMouseEnter={() => handleCellMouseEnter(cell.rowIndex, cell.columnIndex)}
                                            style={{
                                                ...(cell.isMerged ? mergedCellStyle : {}),
                                                ...(isSelected ? selectedCellStyle : {}),
                                                ...(cell.isBlocked ? blockedCellStyle : {})
                                            }}
                                        >
                                            <div className="tableview-cell-content">
                                                {props.enableCheckbox && (
                                                    <input
                                                        type="checkbox"
                                                        className="tableview-checkbox"
                                                        checked={cell.checked}
                                                        onChange={(e) => {
                                                            e.stopPropagation();
                                                            handleCheckboxChange(cell.rowIndex, cell.columnIndex);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                )}
                                                {props.enableCellEditing && (
                                                    <input
                                                        type="text"
                                                        className="tableview-cell-input"
                                                        value={cell.sequenceNumber}
                                                        onChange={(e) => handleCellValueChange(cell.rowIndex, cell.columnIndex, e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        placeholder="#"
                                                    />
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          </div>
        </div>

            {/* Info */}
            <div className="tableview-info">
                <p>
                    <strong>Table:</strong> {rowCount} rows × {columnCount} columns = {rowCount * columnCount} cells
                </p>
                <p>
                    <strong>Blocked Cells:</strong> {tableRows.reduce((sum, row) => sum + row.cells.filter(c => c.isBlocked).length, 0)}
                </p>
                <p>
                    <strong>Merged Cells:</strong> {tableRows.reduce((sum, row) => sum + row.cells.filter(c => c.isMerged && !c.isHidden).length, 0)}
                </p>
            </div>
        </div>
    );
};

export default Tableview;