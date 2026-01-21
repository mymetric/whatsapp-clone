import React, { useState, useEffect, useCallback } from 'react';
import { mondayService, MondayBoardItem, MondayColumn } from '../services/mondayService';
import { indexedDBService } from '../services/indexedDBService';
import ColumnSelector from './ColumnSelector';
import LeadDetailsModal from './LeadDetailsModal';
import './Board607533664Tab.css';

const BOARD_ID = 607533664;

type SortDirection = 'asc' | 'desc' | null;

interface SortConfig {
  column: string;
  direction: SortDirection;
}

const Board607533664Tab: React.FC = () => {
  const [items, setItems] = useState<MondayBoardItem[]>([]);
  const [columns, setColumns] = useState<MondayColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MondayBoardItem | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: '', direction: null });
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);

  const getAllColumnIdsFromData = (itemsData: MondayBoardItem[]): string[] => {
    const columnIds = new Set<string>();
    itemsData.forEach(item => {
      item.column_values?.forEach(col => {
        columnIds.add(col.id);
      });
    });
    return Array.from(columnIds);
  };

  const refreshItems = useCallback(async () => {
    setUpdating(true);
    setError(null);

    try {
      const result = await mondayService.getBoardItemsWithColumns(BOARD_ID);
      setItems(result.items);
      setColumns(result.columns);
      
      // Salvar no cache
      await indexedDBService.saveBoardData(String(BOARD_ID), result.items, result.columns);
      const now = new Date().toISOString();
      setLastUpdate(now);
      
      console.log('✅ Dados atualizados do servidor');
    } catch (err) {
      console.error('❌ Erro ao atualizar itens do board:', err);
      setError('Erro ao atualizar itens do board');
    } finally {
      setUpdating(false);
    }
  }, []);

  const loadItems = useCallback(async (forceRefresh = false) => {
    // Se não for refresh forçado, tentar carregar do cache primeiro
    if (!forceRefresh) {
      setLoading(true);
      try {
        const cachedData = await indexedDBService.loadBoardData(String(BOARD_ID));
        if (cachedData) {
          console.log('✅ Dados carregados do cache local');
          setItems(cachedData.items);
          setColumns(cachedData.columns);
          setLastUpdate(cachedData.lastUpdate);
          setLoading(false);
          
          // Carregar preferências de colunas
          const preferences = await indexedDBService.loadColumnPreferences(String(BOARD_ID));
          if (preferences) {
            setVisibleColumns(preferences.visibleColumns);
            setColumnOrder(preferences.columnOrder);
          } else {
            // Inicializar com todas as colunas visíveis
            const allColumnIds = getAllColumnIdsFromData(cachedData.items);
            setVisibleColumns(allColumnIds);
            setColumnOrder(allColumnIds);
          }
          
          // Carregar dados atualizados em background
          refreshItems();
          return;
        }
      } catch (err) {
        console.error('⚠️ Erro ao carregar do cache, buscando do servidor:', err);
      }
    }

    // Carregar do servidor
    setLoading(true);
    setError(null);

    try {
      const result = await mondayService.getBoardItemsWithColumns(BOARD_ID);
      setItems(result.items);
      setColumns(result.columns);
      
      // Salvar no cache
      await indexedDBService.saveBoardData(String(BOARD_ID), result.items, result.columns);
      const now = new Date().toISOString();
      setLastUpdate(now);
      
      // Carregar ou inicializar preferências de colunas
      const preferences = await indexedDBService.loadColumnPreferences(String(BOARD_ID));
      if (preferences) {
        setVisibleColumns(preferences.visibleColumns);
        setColumnOrder(preferences.columnOrder);
      } else {
        const allColumnIds = getAllColumnIdsFromData(result.items);
        setVisibleColumns(allColumnIds);
        setColumnOrder(allColumnIds);
      }
      
      console.log('✅ Dados carregados do servidor e salvos no cache');
    } catch (err) {
      console.error('❌ Erro ao carregar itens do board:', err);
      setError('Erro ao carregar itens do board');
    } finally {
      setLoading(false);
    }
  }, [refreshItems]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSaveColumnPreferences = async (newVisibleColumns: string[], newColumnOrder: string[]) => {
    setVisibleColumns(newVisibleColumns);
    setColumnOrder(newColumnOrder);
    await indexedDBService.saveColumnPreferences(String(BOARD_ID), newVisibleColumns, newColumnOrder);
    console.log('✅ Preferências de colunas salvas');
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Obtém o nome da coluna - primeiro tenta pegar do column_values, depois do array de columns
  const getColumnTitle = (colId: string, columnValue?: { column?: { title?: string } }): string => {
    // Primeiro, tentar pegar o título diretamente do column_value (melhor opção)
    if (columnValue?.column?.title) {
      return columnValue.column.title;
    }
    
    // Se não tiver no column_value, tentar buscar no array de columns
    if (columns && columns.length > 0) {
      // Tentar correspondência exata primeiro
      let column = columns.find(col => col.id === colId);
      
      if (column) {
        return column.title;
      }
      
      // Se não encontrou, tentar correspondência case-insensitive
      column = columns.find(col => col.id.toLowerCase() === colId.toLowerCase());
      
      if (column) {
        return column.title;
      }
    }
    
    // Fallback: formatação básica do ID
    return colId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Coleta todas as colunas únicas dos itens (para manter a ordem)
  const getAllColumnIds = (): string[] => {
    const columnIds = new Set<string>();
    items.forEach(item => {
      item.column_values?.forEach(col => {
        columnIds.add(col.id);
      });
    });
    return Array.from(columnIds);
  };

  const allColumnIds = getAllColumnIds();
  
  // Usar as colunas ordenadas e filtradas pelas preferências
  const displayColumnIds = columnOrder.length > 0 
    ? columnOrder.filter(id => visibleColumns.includes(id) && allColumnIds.includes(id))
    : allColumnIds.filter(id => visibleColumns.includes(id));

  // Função para ordenar itens
  const handleSort = (columnId: string) => {
    let direction: SortDirection = 'asc';
    
    if (sortConfig.column === columnId) {
      if (sortConfig.direction === 'asc') {
        direction = 'desc';
      } else if (sortConfig.direction === 'desc') {
        direction = null;
      }
    }
    
    setSortConfig({ column: columnId, direction });
  };

  // Função para atualizar filtro de coluna
  const handleColumnFilter = (columnId: string, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  // Limpar todos os filtros
  const clearAllFilters = () => {
    setColumnFilters({});
    setSearchTerm('');
  };

  // Filtra itens pela busca global e filtros de coluna
  const getFilteredItems = () => {
    return items.filter((item) => {
      // Filtro de busca global
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(term);
        const matchesColumns = item.column_values?.some(col => 
          col.text?.toLowerCase().includes(term)
        );
        if (!matchesName && !matchesColumns) return false;
      }

      // Filtros individuais por coluna
      for (const [columnId, filterValue] of Object.entries(columnFilters)) {
        if (filterValue.trim()) {
          const columnValue = item.column_values?.find(col => col.id === columnId);
          const text = columnValue?.text || '';
          if (!text.toLowerCase().includes(filterValue.toLowerCase())) {
            return false;
          }
        }
      }

      return true;
    });
  };

  // Ordena e filtra itens
  const getSortedAndFilteredItems = () => {
    const filtered = getFilteredItems();

    if (!sortConfig.direction || !sortConfig.column) {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      let aValue: string;
      let bValue: string;

      if (sortConfig.column === 'name') {
        aValue = a.name || '';
        bValue = b.name || '';
      } else if (sortConfig.column === 'created_at') {
        aValue = a.created_at || '';
        bValue = b.created_at || '';
      } else {
        const aCol = a.column_values?.find(col => col.id === sortConfig.column);
        const bCol = b.column_values?.find(col => col.id === sortConfig.column);
        aValue = aCol?.text || '';
        bValue = bCol?.text || '';
      }

      // Tentar converter para número se possível
      const aNum = parseFloat(aValue);
      const bNum = parseFloat(bValue);
      
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }

      // Comparação de strings
      const comparison = aValue.localeCompare(bValue, 'pt-BR', { numeric: true, sensitivity: 'base' });
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  };

  const filteredItems = getSortedAndFilteredItems();

  // Verifica se há filtros ativos
  const hasActiveFilters = searchTerm.trim() !== '' || Object.values(columnFilters).some(v => v.trim() !== '');

  if (loading) {
    return (
      <div className="board-tab">
        <div className="board-loading">
          <div className="loading-spinner"></div>
          <p>Carregando itens do board...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="board-tab">
        <div className="board-error">
          <div className="error-icon">⚠️</div>
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
          <button onClick={() => loadItems(true)} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="board-tab">
        <div className="board-empty">
          <div className="empty-icon">📋</div>
          <h3>Nenhum item encontrado</h3>
          <p>Não há itens cadastrados neste board</p>
          <button onClick={() => loadItems(true)} className="retry-button">
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="board-tab">
      <div className="board-header">
        <div className="board-title">
          <span className="board-icon">📊</span>
          <h2>Atendimento</h2>
          <span className="board-count" title="Total de itens">
            {items.length} item(s)
          </span>
          {lastUpdate && (
            <span className="board-last-update" title="Última atualização">
              {new Date(lastUpdate).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          )}
          {updating && (
            <span className="board-updating">
              <div className="updating-spinner"></div>
              Atualizando...
            </span>
          )}
        </div>
        <div className="board-search">
          <input
            type="text"
            placeholder="Buscar itens..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => setShowFilters(!showFilters)} 
          className={`filter-button ${showFilters ? 'active' : ''}`}
          title="Filtros por coluna"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/>
          </svg>
          {hasActiveFilters && <span className="filter-badge"></span>}
        </button>
        {hasActiveFilters && (
          <button 
            onClick={clearAllFilters} 
            className="clear-filters-button" 
            title="Limpar filtros"
          >
            ✕ Limpar
          </button>
        )}
        <button 
          onClick={() => setShowColumnSelector(true)} 
          className="columns-button" 
          title="Selecionar colunas"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/>
          </svg>
        </button>
        <button 
          onClick={() => loadItems(true)} 
          className="refresh-button" 
          title="Atualizar dados"
          disabled={updating}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={updating ? 'spinning' : ''}>
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      <div className="board-content">
        <div className="board-table-container">
          <table className="board-table">
            <thead>
              <tr>
                <th 
                  className={`col-name sortable ${sortConfig.column === 'name' ? 'sorted' : ''}`}
                  onClick={() => handleSort('name')}
                >
                  <div className="th-content">
                    <span>Nome</span>
                    {sortConfig.column === 'name' && (
                      <span className="sort-icon">
                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                {displayColumnIds.map((colId) => {
                  const column = columns.find(col => col.id === colId);
                  const columnTitle = column?.title || colId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                  
                  return (
                    <th 
                      key={colId} 
                      className={`col-value sortable ${sortConfig.column === colId ? 'sorted' : ''}`}
                      onClick={() => handleSort(colId)}
                      title={`ID: ${colId} - Clique para ordenar`}
                    >
                      <div className="th-content">
                        <span>{columnTitle}</span>
                        {sortConfig.column === colId && (
                          <span className="sort-icon">
                            {sortConfig.direction === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th 
                  className={`col-date sortable ${sortConfig.column === 'created_at' ? 'sorted' : ''}`}
                  onClick={() => handleSort('created_at')}
                >
                  <div className="th-content">
                    <span>Criado em</span>
                    {sortConfig.column === 'created_at' && (
                      <span className="sort-icon">
                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              </tr>
              {showFilters && (
                <tr className="filter-row">
                  <th className="col-name">
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={columnFilters['name'] || ''}
                      onChange={(e) => handleColumnFilter('name', e.target.value)}
                      className="column-filter-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                  {displayColumnIds.map((colId) => (
                    <th key={colId} className="col-value">
                      <input
                        type="text"
                        placeholder="Filtrar..."
                        value={columnFilters[colId] || ''}
                        onChange={(e) => handleColumnFilter(colId, e.target.value)}
                        className="column-filter-input"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                  <th className="col-date">
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={columnFilters['created_at'] || ''}
                      onChange={(e) => handleColumnFilter('created_at', e.target.value)}
                      className="column-filter-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr 
                  key={item.id} 
                  className="board-row clickable"
                  onClick={() => setSelectedItem(item)}
                  title="Clique para ver detalhes"
                >
                  <td className="col-name">
                    <strong>{item.name}</strong>
                  </td>
                  {displayColumnIds.map((colId) => {
                    const columnValue = item.column_values?.find(col => col.id === colId);
                    return (
                      <td key={colId} className="col-value">
                        {columnValue?.text || '-'}
                      </td>
                    );
                  })}
                  <td className="col-date">
                    {formatDate(item.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredItems.length === 0 && (
            <div className="board-empty-search">
              <p>Nenhum item encontrado com a busca "{searchTerm}"</p>
            </div>
          )}
        </div>
      </div>

      {showColumnSelector && (
        <ColumnSelector
          allColumns={allColumnIds}
          visibleColumns={visibleColumns}
          columnOrder={columnOrder}
          getColumnTitle={getColumnTitle}
          onSave={handleSaveColumnPreferences}
          onClose={() => setShowColumnSelector(false)}
        />
      )}

      {selectedItem && (
        <LeadDetailsModal
          item={selectedItem}
          columns={columns}
          boardId={BOARD_ID}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
};

export default Board607533664Tab;
