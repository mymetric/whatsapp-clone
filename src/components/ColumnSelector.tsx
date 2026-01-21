import React, { useState, useEffect } from 'react';
import './ColumnSelector.css';

interface ColumnSelectorProps {
  allColumns: string[];
  visibleColumns: string[];
  columnOrder: string[];
  getColumnTitle: (colId: string) => string;
  onSave: (visibleColumns: string[], columnOrder: string[]) => void;
  onClose: () => void;
}

const ColumnSelector: React.FC<ColumnSelectorProps> = ({
  allColumns,
  visibleColumns,
  columnOrder,
  getColumnTitle,
  onSave,
  onClose,
}) => {
  const [selectedColumns, setSelectedColumns] = useState<string[]>(visibleColumns);
  const [orderedColumns, setOrderedColumns] = useState<string[]>(columnOrder);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  useEffect(() => {
    // Garantir que todas as colunas em columnOrder existam em allColumns
    const validOrder = columnOrder.filter(col => allColumns.includes(col));
    // Adicionar novas colunas que não estão na ordem
    const newColumns = allColumns.filter(col => !validOrder.includes(col));
    setOrderedColumns([...validOrder, ...newColumns]);
  }, [allColumns, columnOrder]);

  const handleToggleColumn = (colId: string) => {
    if (selectedColumns.includes(colId)) {
      setSelectedColumns(selectedColumns.filter(id => id !== colId));
    } else {
      setSelectedColumns([...selectedColumns, colId]);
    }
  };

  const handleSelectAll = () => {
    setSelectedColumns([...allColumns]);
  };

  const handleDeselectAll = () => {
    setSelectedColumns([]);
  };

  const handleDragStart = (colId: string) => {
    setDraggedColumn(colId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== colId) {
      const draggedIndex = orderedColumns.indexOf(draggedColumn);
      const targetIndex = orderedColumns.indexOf(colId);
      
      const newOrder = [...orderedColumns];
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedColumn);
      
      setOrderedColumns(newOrder);
    }
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
  };

  const handleSave = () => {
    onSave(selectedColumns, orderedColumns);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="column-selector-backdrop" onClick={handleBackdropClick}>
      <div className="column-selector-content">
        <div className="column-selector-header">
          <h2>Selecionar Colunas</h2>
          <button className="column-selector-close" onClick={onClose}>
            ×
          </button>
        </div>
        
        <div className="column-selector-body">
          <div className="column-selector-actions">
            <button onClick={handleSelectAll} className="action-btn">
              Selecionar Todas
            </button>
            <button onClick={handleDeselectAll} className="action-btn">
              Desmarcar Todas
            </button>
          </div>

          <p className="column-selector-hint">
            Arraste as colunas para reordenar
          </p>

          <div className="columns-list">
            {orderedColumns.map((colId) => (
              <div
                key={colId}
                className={`column-item ${selectedColumns.includes(colId) ? 'selected' : ''} ${draggedColumn === colId ? 'dragging' : ''}`}
                draggable
                onDragStart={() => handleDragStart(colId)}
                onDragOver={(e) => handleDragOver(e, colId)}
                onDragEnd={handleDragEnd}
              >
                <div className="column-drag-handle">
                  ⋮⋮
                </div>
                <label className="column-label">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(colId)}
                    onChange={() => handleToggleColumn(colId)}
                  />
                  <span className="column-title">{getColumnTitle(colId)}</span>
                  <span className="column-id">({colId})</span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="column-selector-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-save" onClick={handleSave}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColumnSelector;
