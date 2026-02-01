import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ShoppingCart, Plus, Minus, X, Trash2, Download, Settings, User, MapPin, Phone, Edit3, Check, Upload, FileText, Image as ImageIcon, LayoutTemplate, Grid, List, PlusCircle, Save, FolderDown, FolderUp, Eye, ArrowLeft, MoreHorizontal } from 'lucide-react';
import initialProductsData from './data/products.json';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Toaster, toast } from 'sonner';

// Utility to format price
const formatPrice = (price) => {
  if (price === null || price === undefined) return '¥0';
  return `¥${Number(price).toLocaleString()}`;
};

// --- Fonts for PDF (Base64 placeholders - real app should load font file) ---
// For true vector Chinese text in jsPDF, we need a custom font. 
// We will use a system font workaround for now or rely on the image export for "perfect" look if font is missing.
// However, user specifically asked for vector text. jsPDF default fonts don't support Chinese.
// We need to add a Chinese font. Since we can't easily download one here without external access, 
// we will assume the user accepts that for now we might need to use a standard font or image for complex chars if not provided.
// BUT: jspdf-autotable supports standard fonts.
// To support Chinese in jsPDF, we MUST add a font. 
// Plan: We will try to use a basic font or provide instructions. 
// Actually, without a .ttf file loaded into jsPDF, Chinese will show as garbage.
// Let's stick to the best effort: 
// 1. We will use the HTML-based export for images (already good).
// 2. For PDF, if we want vector, we MUST have a font.
// Since I cannot download a 10MB font file easily here, I will stick to the html2canvas approach for PDF *but* optimize resolution,
// OR I will try to use the "Add Image" approach but split pages properly which solves the "cut off" issue.
// The user asked for "Vector" text. This is hard without a custom font file in browser-side jsPDF for Chinese.
// Wait, the user said "otherwise it looks cheap".
// Compromise: I will use high-res image slicing for PDF to ensure quality, but handle pagination so it doesn't cut off.
// True vector Chinese in jsPDF requires loading a ~5-10MB font file (e.g. simhei.ttf) at runtime.
// I'll implement the "Page Splitting" logic for PDF to solve the cutoff issue, which is the main functional problem.
// For vector text, I will add a comment that a font file is needed for true vector Chinese.

function App() {
  // --- Data State (Persisted) ---
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem('products_db');
    return saved ? JSON.parse(saved) : initialProductsData;
  });

  // Save products whenever they change
  useEffect(() => {
    localStorage.setItem('products_db', JSON.stringify(products));
  }, [products]);

  // --- UI State ---
  const [view, setView] = useState('shop'); // 'shop' | 'config'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  // priceMode removed, defaulting to 'retail' base, with custom override
  const [template, setTemplate] = useState('classic'); // 'classic', 'modern', 'minimal', 'noir'
  const [themeColor, setThemeColor] = useState('#009999'); // Default Siemens Teal
  
  // --- Display Options ---
  const [showRetailPrice, setShowRetailPrice] = useState(true);
  const [showDiscountPrice, setShowDiscountPrice] = useState(true);
  
  // --- Mobile UX State ---
  const [isConfigOpen, setIsConfigOpen] = useState(false); // Replaces isConfigCollapsed with a drawer state
  const [isMobileFit, setIsMobileFit] = useState(true); // Default to fit screen on mobile

  // --- Modals State ---
  const [showProductManager, setShowProductManager] = useState(false);
  // showSettings removed, integrated into 'config' view
  // showPreviewModal removed, integrated into 'config' view
  
  // --- Editing State ---
  const [editingProduct, setEditingProduct] = useState(null); // For Add/Edit Product Modal

  // --- Customer & Dealer Info ---
  const [customerInfo, setCustomerInfo] = useState(() => {
    const saved = localStorage.getItem('customer_info');
    return saved ? JSON.parse(saved) : { name: '尊敬的客户', phone: '', address: '' };
  });
  const [dealerInfo, setDealerInfo] = useState(() => {
    const saved = localStorage.getItem('dealer_info');
    return saved ? JSON.parse(saved) : { 
      name: '西门子家电官方授权店', 
      contact: '王经理', 
      phone: '13800138000', 
      address: '红星美凯龙一楼A808' 
    };
  });
  const [qrCode, setQrCode] = useState(() => localStorage.getItem('qr_code_img') || null);
  const [isExporting, setIsExporting] = useState(false);
  const qrInputRef = useRef(null);
  const productImgInputRef = useRef(null);
  
  // Font Cache
  const fontCache = useRef(null);

  // Preload Font
  useEffect(() => {
    const preloadFont = async () => {
        try {
            const fontRes = await fetch(window.location.origin + '/fonts/simhei.ttf');
            if (fontRes.ok) {
                const fontBlob = await fontRes.blob();
                const reader = new FileReader();
                reader.onloadend = () => {
                    fontCache.current = reader.result.split(',')[1];
                    console.log('Font loaded and cached');
                };
                reader.readAsDataURL(fontBlob);
            }
        } catch (e) {
            console.warn('Font preload failed', e);
        }
    };
    preloadFont();
  }, []);

  // Persist Info
  useEffect(() => {
    localStorage.setItem('customer_info', JSON.stringify(customerInfo));
    localStorage.setItem('dealer_info', JSON.stringify(dealerInfo));
    if (qrCode) localStorage.setItem('qr_code_img', qrCode);
  }, [customerInfo, dealerInfo, qrCode]);

  // --- Derived State ---
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return ['全部', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesSearch = (product.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             product.model?.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === '全部' || product.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory, products]);

  const cartTotal = useMemo(() => {
    return cart.reduce((total, item) => {
      // Use overridePrice if exists, else retail
      const price = item.overridePrice !== undefined ? item.overridePrice : item.price_retail;
      return total + (Number(price) || 0) * item.quantity;
    }, 0);
  }, [cart]);

  // --- Handlers: Data Management ---
  const exportData = () => {
    const data = {
      products,
      customerInfo,
      dealerInfo
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `siemens-data-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('数据已导出');
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.products) setProducts(data.products);
        if (data.customerInfo) setCustomerInfo(data.customerInfo);
        if (data.dealerInfo) setDealerInfo(data.dealerInfo);
        toast.success('数据已恢复');
      } catch {
        toast.error('文件格式错误');
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    if (confirm('确定要重置所有产品数据吗？您的自定义产品将会丢失，并恢复为最新的官方数据（包含最新图片）。')) {
      setProducts(initialProductsData);
      localStorage.removeItem('products_db');
      toast.success('已恢复官方数据');
    }
  };

  // --- Handlers: Cart ---
  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    toast.success(`已添加: ${product.name}`);
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateQuantity = (productId, delta) => {
    setCart(prev => prev.map(item => {
      if (item.id === productId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const updateCartItemPrice = (id, newPrice) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, overridePrice: Number(newPrice) };
      }
      return item;
    }));
  };

  // --- Handlers: Product Management ---
  const handleAddProduct = () => {
    setEditingProduct({
      id: `NEW_${Date.now()}`,
      name: '',
      model: '',
      category: '其他',
      price_retail: 0,
      price_package: 0,
      features: '',
      image: null
    });
    setShowProductManager(true);
  };

  const handleEditProduct = (product) => {
    setEditingProduct({ ...product });
    setShowProductManager(true);
  };

  const handleSaveProduct = () => {
    if (!editingProduct.name || !editingProduct.model) {
      toast.error('名称和型号必填');
      return;
    }
    
    setProducts(prev => {
      const exists = prev.find(p => p.id === editingProduct.id);
      if (exists) {
        return prev.map(p => p.id === editingProduct.id ? editingProduct : p);
      }
      return [editingProduct, ...prev];
    });
    
    setShowProductManager(false);
    toast.success('产品已保存');
  };

  const handleDeleteProduct = (id) => {
    if (confirm('确定要删除这个产品吗？')) {
      setProducts(prev => prev.filter(p => p.id !== id));
      toast.success('产品已删除');
    }
  };

  const handleProductImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditingProduct(prev => ({ ...prev, image: reader.result })); // Store as Base64
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Handlers: QR Upload ---
  const handleQrUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setQrCode(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Handlers: Export ---
  const handleExportImage = async () => {
    const toastId = toast.loading('正在生成图片...');
    setIsExporting(true); // Ensure inputs are rendered as text for better capture
    
    // Store scroll position
    const scrollPos = window.scrollY;
    
    // Wait for state update to re-render
    setTimeout(async () => {
      requestAnimationFrame(async () => {
        const element = document.getElementById('quotation-preview-content');
        if (!element) {
          toast.dismiss(toastId);
          setIsExporting(false);
          return;
        }
        
        try {
          // Temporarily scroll to top to avoid offset issues
          window.scrollTo(0, 0);

          const canvas = await html2canvas(element, { 
            scale: 3, // Increased resolution (High DPI)
            useCORS: true, 
            logging: false, 
            backgroundColor: template === 'noir' ? '#1a1a1a' : '#ffffff',
            allowTaint: true,
            scrollX: 0,
            scrollY: 0,
            // No onclone width hack needed, as we now control width via state
          });
          
          const link = document.createElement('a');
          link.download = `报价_${customerInfo.name}.png`;
          link.href = canvas.toDataURL('image/png', 0.8);
          link.click();
          
          toast.success('图片导出成功', { id: toastId });
        } catch (err) { 
          console.error(err);
          toast.error('导出失败', { id: toastId }); 
        } finally {
          // Restore scroll position
          window.scrollTo(0, scrollPos);
          setIsExporting(false);
        }
      });
    }, 100);
  };

  const handleExportLongPDF = async () => {
    const toastId = toast.loading('正在生成长图 PDF...');
    setIsExporting(true);
    
    setTimeout(async () => {
        const element = document.getElementById('quotation-preview-content');
        if (!element) {
          toast.dismiss(toastId);
          setIsExporting(false);
          return;
        }
        
        try {
          const scrollPos = window.scrollY;
          // Temporarily disable scale and remove shadow to ensure full width capture
          const originalTransform = element.style.transform;
          const originalTransformOrigin = element.style.transformOrigin;
          const originalBoxShadow = element.style.boxShadow;
          
          element.style.transform = 'none';
          element.style.transformOrigin = 'top left';
          element.style.boxShadow = 'none'; // Remove shadow which might add margin in capture
          
          // DO NOT Force A4 width for long PDF - Let it be natural width
          // We want to capture exactly what is seen (but unscaled)
          // const originalWidth = element.style.width;
          // element.style.width = '794px'; 

          window.scrollTo(0, 0);

          const canvas = await html2canvas(element, { 
            scale: 2, 
            useCORS: true, 
            logging: false, 
            backgroundColor: template === 'noir' ? '#1a1a1a' : '#ffffff',
            allowTaint: true,
            // Use natural width/height
            // width: 794,
            // windowWidth: 794,
          });
          
          // Restore styles
          if (isMobileFit) {
             // Re-apply if needed, or let react handle it
             // Actually we just removed inline styles, react state update will restore it on next render or we can leave it empty
             // But to be safe:
             // element.style.transform = originalTransform; // This might be stale if state changed? No.
             // But better to just clear and let React control
             element.style.transform = '';
             element.style.transformOrigin = '';
          }
          element.style.boxShadow = '';
          // element.style.width = originalWidth;
          
          window.scrollTo(0, scrollPos);

          const imgData = canvas.toDataURL('image/png');
          
          // Calculate dimensions
          // We want the PDF page to match the image aspect ratio exactly.
          // We can set PDF width to A4 width (210mm) and scale height, OR set PDF size to match pixels (converted to mm).
          // To avoid "narrowing", we should ensure the PDF width is consistent with A4 width IF printed,
          // but for digital viewing, matching the pixel ratio is key.
          
          // Let's use standard A4 width as reference for "100% zoom" feeling
          const pdfWidth = 210; 
          const contentRatio = canvas.height / canvas.width;
          const pdfHeight = pdfWidth * contentRatio;

          // Create PDF with custom page size matching content
          const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight]);
          
          // Fill background
          const bgColor = template === 'noir' ? '#1a1a1a' : '#ffffff';
          pdf.setFillColor(bgColor);
          pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
          
          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
          pdf.save(`报价长图_${customerInfo.name}.pdf`);
          
          toast.success('长图 PDF 导出成功', { id: toastId });
        } catch (err) {
          console.error(err);
          toast.error('导出失败', { id: toastId });
        } finally {
            setIsExporting(false);
        }
    }, 500);
  };

  const handleExportPDF = async () => {
    const toastId = toast.loading('正在准备导出...');
    setIsExporting(true); // Switch to print mode
    
    // Wait for render to update (remove inputs, fix styles)
    setTimeout(async () => {
        const element = document.getElementById('quotation-preview-content');
        if (!element) {
          toast.dismiss(toastId);
          setIsExporting(false);
          return;
        }
        
        try {
          // Temporarily disable scale and remove shadow
          const originalTransform = element.style.transform;
          const originalTransformOrigin = element.style.transformOrigin;
          const originalBoxShadow = element.style.boxShadow;
          
          element.style.transform = 'none';
          element.style.transformOrigin = 'top left';
          element.style.boxShadow = 'none';
          
          // Force A4 width for calculation
          const originalWidth = element.style.width;
          element.style.width = '794px'; 
          
          // 1. Calculate Split Points (Smart Pagination)
          
          const A4_RATIO = 297 / 210;
          const virtualWidth = 794; // Fixed A4 pixel width
          // Reduce page height slightly to create a safety margin at bottom (prevent content touching edge)
          const pageHeight = (virtualWidth * A4_RATIO) - 40; 
          
          const splitPoints = [];
          let currentSplit = 0;
          
          const blocks = [];
          // Helper to add blocks
          const addBlock = (selector) => {
              const elements = element.querySelectorAll(selector);
              elements.forEach(el => {
                // Add a small buffer to bottom to avoid cutting right at the border
                blocks.push({ top: el.offsetTop, height: el.offsetHeight, bottom: el.offsetTop + el.offsetHeight + 10 });
              });
          };
          
          addBlock('.preview-header'); 
          addBlock('.preview-info');   
          addBlock('tbody tr'); // Directly select all rows
          
          // Group Total and Footer together to prevent splitting
          // Instead of adding them separately, we add a wrapper logic or just treat them as one block if possible.
          // Since we can't easily wrap them in DOM without changing structure, we will treat the start of 'total' to end of 'footer' as one logical block for splitting purposes.
          
          const totalEl = element.querySelector('.preview-total');
          const footerEl = element.querySelector('.preview-footer');
          const bottomBarEl = element.querySelector('.preview-bottom-bar');
          
          if (totalEl && footerEl && bottomBarEl) {
             // Create a "Super Block" that covers Total + Footer + BottomBar
             // This ensures if a split happens here, it happens BEFORE the Total, moving the whole footer section to next page
             const startTop = totalEl.offsetTop;
             const endBottom = bottomBarEl.offsetTop + bottomBarEl.offsetHeight;
             blocks.push({ top: startTop, height: endBottom - startTop, bottom: endBottom + 10 });
          } else {
             // Fallback if elements missing
             addBlock('.preview-total');  
             addBlock('.preview-footer'); 
             addBlock('.preview-bottom-bar'); 
          }
          
          blocks.sort((a, b) => a.top - b.top);
          const totalHeight = element.scrollHeight;
          
          // Improved splitting logic to prevent infinite loops and bad cuts
          while (currentSplit + pageHeight < totalHeight) {
              let proposedSplit = currentSplit + pageHeight;
              let bestSplit = proposedSplit;
              
              // Find block that overlaps the split line
              // We look for blocks that START before the split and END after the split
              // Also consider blocks that are just dangerously close to the split (within 20px)
              const overlappingBlock = blocks.find(b => b.top < proposedSplit && b.bottom > proposedSplit);
              
              if (overlappingBlock) {
                  // If we are cutting through a block, move the split UP to the top of that block
                  if (overlappingBlock.top > currentSplit) {
                      bestSplit = overlappingBlock.top;
                  } else {
                     // Block is taller than a page (very rare for rows) or we are stuck.
                     // If it's a row that is huge, we might have to cut it.
                     // But usually, we just cut at proposedSplit.
                  }
              }
              
              // Safety: ensure we make progress. If bestSplit is same as current, force move.
              if (bestSplit <= currentSplit + 10) { 
                  bestSplit = proposedSplit; 
              }
              
              splitPoints.push(bestSplit);
              currentSplit = bestSplit;
          }
          splitPoints.push(totalHeight);
          
          // 2. Capture & Generate
          const scrollPos = window.scrollY;
          
          window.scrollTo(0, 0);
  
          // Capture High-Res Canvas
          // On mobile, limiting the canvas size might be necessary, but let's try standard approach first.
          const canvas = await html2canvas(element, { 
            scale: 2, // Reduced scale slightly for mobile stability (3 -> 2), still high enough for print
            useCORS: true, 
            logging: false, 
            backgroundColor: template === 'noir' ? '#1a1a1a' : '#ffffff',
            allowTaint: true,
            height: totalHeight, 
            windowHeight: totalHeight,
            width: 794, // Force correct width to match content
            windowWidth: 794,
          });
          
          // Restore styles
          if (isMobileFit) {
             element.style.transform = '';
             element.style.transformOrigin = '';
          }
          element.style.boxShadow = '';
          element.style.width = originalWidth;
          
          // Restore scroll
          window.scrollTo(0, scrollPos);
  
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();
          
          let startY = 0;
          const bgColor = template === 'noir' ? '#1a1a1a' : '#ffffff';
          
          for (let i = 0; i < splitPoints.length; i++) {
              const endY = splitPoints[i];
              const segmentHeight = endY - startY;
              
              if (i > 0) pdf.addPage();
              
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = canvas.width;
              // We need to maintain the aspect ratio of the slice
              tempCanvas.height = segmentHeight * 2; // scale matches html2canvas scale
              
              const ctx = tempCanvas.getContext('2d');
              
              // Fill background
              ctx.fillStyle = bgColor;
              ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
              
              // Draw the slice
              ctx.drawImage(
                  canvas, 
                  0, startY * 2, canvas.width, segmentHeight * 2, 
                  0, 0, tempCanvas.width, tempCanvas.height       
              );
              
              const imgData = tempCanvas.toDataURL('image/png');
              // Calculate PDF image height based on width ratio
              const imgPdfHeight = (segmentHeight * 2 * pdfWidth) / tempCanvas.width;
              
              // Fill PDF page background
              pdf.setFillColor(bgColor); 
              pdf.rect(0, 0, pdfWidth, pdfHeight, 'F'); 
              
              pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgPdfHeight);
              
              startY = endY;
          }
  
          pdf.save(`报价_${customerInfo.name}.pdf`);
          toast.success('PDF导出成功', { id: toastId });
          
        } catch (err) {
          console.error(err);
          toast.error('PDF生成失败', { id: toastId });
        } finally {
            setIsExporting(false);
        }
    }, 500); // Increased timeout to ensure render
  };

  // --- Views ---
  
  if (view === 'config') {
    return (
      <div className="min-h-screen bg-gray-50 font-sans text-slate-800 flex flex-col">
        <Toaster position="top-center" />
        {/* Navbar */}
        <div className="bg-white border-b px-4 py-3 flex justify-between items-center sticky top-0 z-20 shadow-sm">
           <div className="flex items-center gap-2">
             <button onClick={() => setView('shop')} className="p-2 hover:bg-gray-100 rounded-full transition">
               <ArrowLeft className="w-5 h-5" />
             </button>
             <h1 className="font-bold text-lg">生成报价单</h1>
           </div>
           <div className="flex gap-2">
              <button onClick={handleExportImage} className="px-4 py-2 bg-white border border-gray-200 text-slate-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-50 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> 存为图片
              </button>
              <button onClick={handleExportPDF} className="px-4 py-2 bg-[#009999] text-white rounded-lg text-sm font-medium shadow-sm hover:bg-[#007a7a] flex items-center gap-2">
                <FileText className="w-4 h-4" /> 导出 PDF
              </button>
              <button onClick={handleExportLongPDF} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium shadow-sm hover:bg-slate-700 flex items-center gap-2" title="生成不分页的长图PDF">
                <LayoutTemplate className="w-4 h-4" /> 长图PDF
              </button>
           </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
           {/* Sidebar Config (Desktop) / Drawer (Mobile) */}
           <div className={`
              fixed inset-0 z-50 bg-white transition-transform duration-300 md:static md:w-80 md:border-r md:translate-x-0 md:shadow-none
              ${isConfigOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
           `}>
              {/* Mobile Header in Drawer */}
              <div className="md:hidden flex justify-between items-center p-4 border-b">
                 <h2 className="font-bold text-lg flex items-center gap-2">
                    <Settings className="w-5 h-5" /> 设置面板
                 </h2>
                 <button onClick={() => setIsConfigOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-6 h-6" />
                 </button>
              </div>

              {/* Scrollable Config Content */}
              <div className="overflow-y-auto h-full p-5 space-y-6 pb-24 md:pb-5">
              
              {/* Template */}
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">选择模板</h3>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { id: 'classic', label: '经典表格', icon: Grid },
                    { id: 'modern', label: '现代简约', icon: LayoutTemplate },
                    { id: 'minimal', label: '高端留白', icon: List },
                    { id: 'noir', label: '黑金奢华', icon: ImageIcon },
                  ].map(t => (
                    <button 
                      key={t.id}
                      onClick={() => setTemplate(t.id)}
                      className={`p-3 rounded-lg border flex items-center justify-center gap-2 transition ${template === t.id ? 'border-current bg-current/5 text-current' : 'border-gray-200 hover:border-gray-300'}`}
                      style={{ color: template === t.id ? (t.id === 'noir' ? '#1a1a1a' : themeColor) : undefined }}
                    >
                      <t.icon className="w-4 h-4" />
                      <span className="text-xs font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>

                {template !== 'noir' && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">主题配色</h3>
                    <div className="flex gap-3 flex-wrap">
                      {[
                        '#009999', // Siemens Teal
                        '#003366', // Navy Blue
                        '#1e3a8a', // Dark Blue
                        '#b91c1c', // Red
                        '#047857', // Green
                        '#d97706', // Amber
                        '#4b5563', // Gray
                        '#000000', // Black
                      ].map(color => (
                        <button
                          key={color}
                          onClick={() => setThemeColor(color)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${themeColor === color ? 'border-gray-400 scale-110 shadow-md' : 'border-transparent hover:scale-110'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Display Options */}
              <div>
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">显示设置</h3>
                 <div className="space-y-2">
                    <label className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 cursor-pointer">
                       <span className="text-xs font-bold">适应手机屏幕</span>
                       <input type="checkbox" checked={isMobileFit} onChange={e => setIsMobileFit(e.target.checked)} className="accent-[#009999]" />
                    </label>
                    <label className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 cursor-pointer">
                       <span className="text-xs font-bold">显示零售价</span>
                       <input type="checkbox" checked={showRetailPrice} onChange={e => setShowRetailPrice(e.target.checked)} className="accent-[#009999]" />
                    </label>
                    <label className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 cursor-pointer">
                       <span className="text-xs font-bold">显示优惠价</span>
                       <input type="checkbox" checked={showDiscountPrice} onChange={e => setShowDiscountPrice(e.target.checked)} className="accent-[#009999]" />
                    </label>
                 </div>
              </div>

              {/* Canvas Width Control Removed as requested */}
              {/* <div className={isConfigCollapsed ? 'hidden md:block' : ''}>...</div> */}

              {/* Customer Info */}
              <div>
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">客户信息</h3>
                 <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-gray-400">姓名</label>
                       <input className="w-full p-2 border rounded text-sm" value={customerInfo.name} onChange={e => setCustomerInfo({...customerInfo, name: e.target.value})} />
                    </div>
                    <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-gray-400">电话</label>
                       <input className="w-full p-2 border rounded text-sm" value={customerInfo.phone} onChange={e => setCustomerInfo({...customerInfo, phone: e.target.value})} />
                    </div>
                    <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-gray-400">地址</label>
                       <input className="w-full p-2 border rounded text-sm" value={customerInfo.address} onChange={e => setCustomerInfo({...customerInfo, address: e.target.value})} />
                    </div>
                 </div>
              </div>

              {/* Dealer Info */}
              <div>
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">门店信息</h3>
                 <div className="space-y-3">
                    <input className="w-full p-2 border rounded text-sm" placeholder="门店名称" value={dealerInfo.name} onChange={e => setDealerInfo({...dealerInfo, name: e.target.value})} />
                    <input className="w-full p-2 border rounded text-sm" placeholder="联系人" value={dealerInfo.contact} onChange={e => setDealerInfo({...dealerInfo, contact: e.target.value})} />
                    <input className="w-full p-2 border rounded text-sm" placeholder="电话" value={dealerInfo.phone} onChange={e => setDealerInfo({...dealerInfo, phone: e.target.value})} />
                    <input className="w-full p-2 border rounded text-sm" placeholder="地址" value={dealerInfo.address} onChange={e => setDealerInfo({...dealerInfo, address: e.target.value})} />
                 </div>
              </div>

              {/* QR Code */}
              <div>
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">顾问二维码</h3>
                 <div 
                    onClick={() => qrInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-xl h-24 flex items-center justify-center cursor-pointer hover:border-[#009999] bg-gray-50 overflow-hidden relative"
                  >
                     {qrCode ? (
                        <>
                           <img src={qrCode} className="w-full h-full object-contain" />
                           <div className="absolute inset-0 bg-black/20 opacity-0 hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition">更换</div>
                        </>
                     ) : (
                        <div className="text-xs text-gray-400 flex flex-col items-center gap-1">
                           <Upload className="w-4 h-4" /> 点击上传
                        </div>
                     )}
                     <input ref={qrInputRef} type="file" accept="image/*" className="hidden" onChange={handleQrUpload} />
                  </div>
              </div>

              {/* Data Tools */}
              <div className="pt-4 border-t">
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">数据管理</h3>
                 <div className="grid grid-cols-2 gap-2 mb-2">
                    <button onClick={exportData} className="px-3 py-2 border rounded text-xs hover:bg-gray-50">备份数据</button>
                    <label className="px-3 py-2 border rounded text-xs hover:bg-gray-50 text-center cursor-pointer">
                       恢复数据
                       <input type="file" accept=".json" className="hidden" onChange={importData} />
                    </label>
                 </div>
                 <button onClick={handleResetData} className="w-full px-3 py-2 border border-red-100 text-red-500 bg-red-50 rounded text-xs hover:bg-red-100">重置为官方默认</button>
              </div>
              
              </div>
           </div>

           {/* Mobile Floating Settings Button */}
           <button 
              onClick={() => setIsConfigOpen(true)}
              className="md:hidden fixed bottom-6 right-6 bg-slate-900 text-white p-4 rounded-full shadow-2xl z-40 flex items-center justify-center hover:scale-105 transition active:scale-95 touch-manipulation"
           >
              <Settings className="w-6 h-6" />
           </button>

           {/* Mobile Overlay Backdrop */}
           {isConfigOpen && (
              <div 
                className="fixed inset-0 bg-black/50 z-40 md:hidden"
                onClick={() => setIsConfigOpen(false)}
              />
           )}

           {/* Preview Area */}
           <div className="flex-1 bg-gray-100 overflow-auto p-4 md:p-8 flex justify-start md:justify-center items-start scroll-smooth -webkit-overflow-scrolling-touch">
              <div 
                 id="quotation-preview-content" 
                 className={`shadow-2xl ${template === 'noir' ? 'bg-[#1a1a1a] text-white' : (template === 'elegant' ? 'bg-[#f8f9fa] text-slate-800' : 'bg-white text-slate-800')} transition-all duration-300 origin-top flex flex-col`}
                 style={{ 
                    width: isMobileFit ? '794px' : '100%', 
                    maxWidth: isMobileFit ? 'none' : '1000px', // Max width on desktop for readability
                    minHeight: isMobileFit ? `${794 * 1.414}px` : '1000px',
                    // Mobile Fit Scaling - Only apply if mobile fit is ON AND we are on a small screen
                    transform: isMobileFit && window.innerWidth < 800 ? `scale(${Math.min(1, (window.innerWidth - 32) / 794)})` : 'none',
                    transformOrigin: 'top left',
                    marginBottom: isMobileFit && window.innerWidth < 800 ? `-${794 * 1.414 * (1 - Math.min(1, (window.innerWidth - 32) / 794))}px` : '0'
                 }}
              >
                 <PreviewContent 
                    cart={cart}  
                    template={template} 
                    themeColor={themeColor}
                    customerInfo={customerInfo} 
                    dealerInfo={dealerInfo} 
                    cartTotal={cartTotal} 
                    qrCode={qrCode}
                    formatPrice={formatPrice}
                    updateCartItemPrice={updateCartItemPrice}
                    isEditable={true}
                    isExporting={isExporting}
                    showRetailPrice={showRetailPrice}
                    showDiscountPrice={showDiscountPrice}
                 />
              </div>
           </div>
        </div>
      </div>
    );
  }

  // Shop View
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-slate-800">
      <Toaster position="top-center" />
      
      {/* Sidebar / Mobile Header - Product List */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto h-screen scrollbar-thin">
        <header className="mb-6 sticky top-0 bg-gray-50 z-10 pb-4 backdrop-blur-sm bg-opacity-90">
          <div className="flex items-center justify-between mb-4">
             <h1 className="text-2xl font-bold text-[#009999] flex items-center gap-2 tracking-tight">
               SIEMENS <span className="text-slate-600 text-lg font-normal">报价助手</span>
             </h1>
             <div className="flex gap-2">
                <button onClick={handleAddProduct} className="p-2 bg-slate-900 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-black transition touch-manipulation">
                   <PlusCircle className="w-4 h-4" /> 添加产品
                </button>
             </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input 
                type="text"
                placeholder="搜索型号 / 名称..." 
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009999] focus:border-transparent outline-none bg-white shadow-sm transition-all hover:border-gray-300"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <select 
              className="p-2.5 border border-gray-200 rounded-lg bg-white min-w-[120px] shadow-sm outline-none focus:ring-2 focus:ring-[#009999] cursor-pointer"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-24 md:pb-0">
          {filteredProducts.map(product => (
            <div key={product.id} className="group bg-white rounded-xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-4 border border-gray-100 flex flex-col relative">
              <button 
                onClick={(e) => { e.stopPropagation(); handleEditProduct(product); }}
                className="absolute top-2 right-2 p-1.5 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 hover:bg-slate-100 transition z-10 text-slate-500"
                title="编辑产品"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              
              <div className="h-40 bg-gray-50 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden group-hover:bg-gray-100 transition-colors p-2">
                 {product.image ? (
                   <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
                 ) : (
                   <div className="text-center">
                      <span className="text-4xl mb-2 block opacity-80">🧊</span>
                      <span className="text-xs text-gray-400">暂无图片</span>
                   </div>
                 )}
                 <span className="absolute top-2 left-2 bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded shadow-sm">
                   {product.category}
                 </span>
              </div>
              <h3 className="font-bold text-slate-800 truncate text-base" title={product.name}>{product.name}</h3>
              <p className="text-sm text-gray-500 mb-3 font-mono tracking-tight">{product.model}</p>
              
              <div className="mt-auto flex items-end justify-between">
                <div>
                  <p className="text-[#009999] font-bold text-lg">{formatPrice(product.price_retail)}</p>
                  <p className="text-xs text-gray-400 transform scale-90 origin-left">建议零售价</p>
                </div>
                <button 
                  onClick={() => addToCart(product)}
                  className="w-9 h-9 flex items-center justify-center bg-slate-900 text-white rounded-full hover:bg-[#009999] active:scale-90 transition-all shadow-md hover:shadow-lg touch-manipulation cursor-pointer"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cart Drawer - now simplified as a quick view */}
      <div className={`fixed inset-y-0 right-0 w-full md:w-[400px] bg-white shadow-2xl transform transition-transform duration-300 z-50 ${isCartOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 md:static md:border-l border-gray-200 flex flex-col`}>
        <div className="p-4 border-b flex items-center justify-between bg-white z-10">
          <div className="flex items-center gap-4">
             <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800">
               <ShoppingCart className="w-5 h-5 text-[#009999]" /> 选购清单
             </h2>
             <span className="bg-[#009999] text-white text-xs px-2 py-0.5 rounded-full font-bold">{cart.length}</span>
          </div>
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-2 text-slate-500">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
          {cart.length === 0 ? (
            <div className="text-center text-slate-400 mt-20"><ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">暂无商品</p></div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex gap-3 bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                <div className="w-14 h-14 bg-slate-50 rounded flex items-center justify-center overflow-hidden shrink-0 p-1">
                   {item.image ? <img src={item.image} className="w-full h-full object-contain" /> : <span className="text-xs text-slate-300">图</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <h4 className="font-bold text-sm truncate">{item.name}</h4>
                    <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                     <span className="text-sm font-bold text-[#009999]">{formatPrice(item.price_retail)}</span>
                     <div className="flex items-center gap-2 bg-slate-100 rounded px-1">
                        <button onClick={() => updateQuantity(item.id, -1)}><Minus className="w-3 h-3" /></button>
                        <span className="text-xs w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)}><Plus className="w-3 h-3" /></button>
                     </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t bg-white safe-area-bottom">
           <div className="flex justify-between items-end mb-4">
              <span className="text-slate-500 text-xs">总计 (零售价)</span>
              <span className="text-2xl font-bold text-[#009999]">{formatPrice(cartTotal)}</span>
           </div>
           <button 
             onClick={() => setView('config')}
             disabled={cart.length === 0}
             className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-black transition disabled:opacity-50"
           >
             <Settings className="w-4 h-4" /> 下一步: 生成报价单
           </button>
        </div>
      </div>

      {/* --- MODAL: Product Manager --- */}
      {showProductManager && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
           <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">{editingProduct.id.startsWith('NEW') ? '添加新产品' : '编辑产品'}</h2>
              <div className="space-y-3">
                 <div className="flex justify-center mb-4">
                    <div onClick={() => productImgInputRef.current?.click()} className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-300 hover:border-[#009999] overflow-hidden">
                       {editingProduct.image ? <img src={editingProduct.image} className="w-full h-full object-cover" /> : <div className="text-center text-xs text-gray-400">上传图片</div>}
                    </div>
                    <input ref={productImgInputRef} type="file" accept="image/*" className="hidden" onChange={handleProductImageUpload} />
                 </div>
                 <input className="w-full p-2 border rounded" placeholder="产品名称" value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} />
                 <input className="w-full p-2 border rounded" placeholder="型号" value={editingProduct.model} onChange={e => setEditingProduct({...editingProduct, model: e.target.value})} />
                 <div className="flex gap-2">
                    <input className="w-full p-2 border rounded" type="number" placeholder="零售价" value={editingProduct.price_retail} onChange={e => setEditingProduct({...editingProduct, price_retail: Number(e.target.value)})} />
                 </div>
                 <input className="w-full p-2 border rounded" placeholder="分类 (如: 冰箱)" value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} />
                 <textarea className="w-full p-2 border rounded h-20" placeholder="功能特性" value={editingProduct.features} onChange={e => setEditingProduct({...editingProduct, features: e.target.value})} />
              </div>
              <div className="flex gap-3 mt-6">
                 {editingProduct.id && !editingProduct.id.startsWith('NEW') && (
                    <button onClick={() => handleDeleteProduct(editingProduct.id)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-5 h-5" /></button>
                 )}
                 <div className="flex-1 flex gap-2 justify-end">
                    <button onClick={() => setShowProductManager(false)} className="px-4 py-2 border rounded text-gray-600">取消</button>
                    <button onClick={handleSaveProduct} className="px-4 py-2 bg-[#009999] text-white rounded">保存</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Mobile Cart Toggle */}
      {!isCartOpen && cart.length > 0 && (
        <button 
          onClick={() => setIsCartOpen(true)}
          className="md:hidden fixed bottom-6 right-6 bg-slate-900 text-white p-4 rounded-full shadow-2xl z-40 flex items-center justify-center hover:scale-105 transition active:scale-95 touch-manipulation"
        >
          <ShoppingCart className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 bg-[#009999] text-white text-xs w-5 h-5 rounded-full flex items-center justify-center border-2 border-white font-bold">
            {cart.length}
          </span>
        </button>
      )}
    </div>
  );
}

// --- Component: Quotation Preview Content ---
const PreviewContent = ({ cart, template, themeColor, customerInfo, dealerInfo, cartTotal, qrCode, formatPrice, updateCartItemPrice, isEditable, isExporting, showRetailPrice, showDiscountPrice }) => {
  const isNoir = template === 'noir';
  const isModern = template === 'modern';
  const isMinimal = template === 'minimal';
  
  const isElegant = false; // Force false as removed
  
  // Colors
  const accentColorObj = { color: isNoir ? 'white' : themeColor };
  const borderColorClass = isNoir ? 'border-gray-700' : 'border-gray-200';
  const subTextColor = isNoir ? 'text-gray-400' : 'text-slate-500';
  
  // Table Styles
  let tableHeadClass = `text-center py-4 px-2 font-bold text-sm ${isNoir ? 'text-gray-300' : 'text-slate-700'} border-b-2 ${borderColorClass} tracking-wide`;
  let tableCellClass = `py-6 px-3 border-b ${borderColorClass} align-middle text-sm`; 

  if (isModern) {
      tableHeadClass = `text-center py-5 px-2 font-bold text-sm text-white border-b-0 tracking-wide`;
      tableCellClass = `py-6 px-3 border-b border-gray-100 align-middle text-sm`; 
  } else if (isMinimal) {
      tableHeadClass = `text-center py-4 px-2 font-medium text-sm ${isNoir ? 'text-gray-300' : 'text-slate-500'} border-b ${borderColorClass} tracking-wide`;
      tableCellClass = `py-6 px-3 border-b-0 align-middle text-sm`; 
  }

  // Responsive padding/font adjustments for different screens
  // We use standard classes but can add style overrides if needed for specific pixel precision
  const responsiveTextClass = "text-xs md:text-sm";
  const responsivePaddingClass = "py-4 md:py-6 px-2"; // Reduced padding for better space utilization
  
  // Update tableCellClass to include responsive spacing
  tableCellClass = `${tableCellClass.replace('py-6 px-3', '')} ${responsivePaddingClass} align-middle ${responsiveTextClass}`;

  // --- Dynamic Column Width Calculation ---
  // Base widths (weights) for always-visible columns
  const baseWeights = {
     name: 12,
     model: 12,
     features: 30, // Increased base weight for features
     quantity: 8,
     image: 12
  };
  
  // Add weights for conditional columns
  if (showRetailPrice) baseWeights.retail = 12;
  if (showDiscountPrice) baseWeights.discount = 12;
  
  // Calculate total weight
  const totalWeight = Object.values(baseWeights).reduce((a, b) => a + b, 0);
  
  // Helper to get percentage width
  const getWidth = (key) => `${(baseWeights[key] / totalWeight) * 100}%`;

  const isExportingOrPreview = isExporting || !isEditable;

  return (
    <div className={`flex flex-col h-full ${isNoir ? 'bg-[#1a1a1a] text-white' : 'bg-white text-slate-800'}`}>
      {/* 1. Header */}
      <div className={`preview-header px-4 md:px-8 py-6 md:py-8 flex justify-between items-end border-b ${isMinimal ? 'border-transparent' : borderColorClass}`}>
         <div>
           <h1 className={`text-3xl md:text-4xl font-extrabold tracking-tighter leading-none mb-2`} style={accentColorObj}>SIEMENS</h1>
           <p className={`${subTextColor} text-[10px] tracking-[0.4em] uppercase pl-1 font-medium`}>Future Moving</p>
         </div>
         <div className="text-right">
           <h2 className={`text-xl md:text-2xl font-light mb-1 tracking-wide ${isNoir ? 'text-white' : 'text-slate-800'}`}>
             {isNoir ? 'PRICE LIST' : '家电配置方案'}
           </h2>
           <p className={`${subTextColor} tracking-[0.2em] uppercase text-[9px] font-medium`}>Quotation Proposal</p>
         </div>
      </div>

      {/* 2. Info Grid */}
      <div className={`preview-info px-4 md:px-8 py-4 md:py-6 grid grid-cols-2 gap-8 md:gap-12 ${isModern ? 'bg-slate-50 mx-4 md:mx-8 rounded-xl my-4 py-4 md:py-6' : ''}`}>
         <div>
            <h3 className={`text-[10px] font-bold ${subTextColor} uppercase tracking-[0.2em] mb-3`}>CUSTOMER</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex gap-3"><span className={`${subTextColor} w-8 inline-block`}>姓名</span><span className={`font-bold ${isNoir ? 'text-white' : 'text-slate-900'}`}>{customerInfo.name}</span></div>
              <div className="flex gap-3"><span className={`${subTextColor} w-8 inline-block`}>电话</span><span className={`${isNoir ? 'text-gray-300' : 'text-slate-700'} font-medium`}>{customerInfo.phone}</span></div>
              <div className="flex gap-3"><span className={`${subTextColor} w-8 inline-block`}>地址</span><span className={`${isNoir ? 'text-gray-400' : 'text-slate-600'}`}>{customerInfo.address}</span></div>
            </div>
         </div>
         <div>
            <h3 className={`text-[10px] font-bold ${subTextColor} uppercase tracking-[0.2em] mb-3`}>DEALER</h3>
            <div className="space-y-1.5 text-xs">
              <div className={`font-bold ${isNoir ? 'text-white' : 'text-slate-900'}`}>{dealerInfo.name}</div>
              <div className={`${isNoir ? 'text-gray-300' : 'text-slate-700'} font-medium`}>{dealerInfo.contact} | {dealerInfo.phone}</div>
              <div className={`${isNoir ? 'text-gray-400' : 'text-slate-600'}`}>{dealerInfo.address}</div>
            </div>
         </div>
      </div>

      {/* 3. Table */}
      <div className={`px-4 md:px-8 flex-1 overflow-x-auto`}>
         <table className={`w-full border-collapse table-fixed min-w-[600px]`}>
            <thead style={isModern ? { backgroundColor: themeColor } : {}}>
               <tr>
                  <th className={`${tableHeadClass} text-left pl-2 rounded-tl-lg`} style={{ width: getWidth('name') }}>产品名称</th>
                  <th className={`${tableHeadClass}`} style={{ width: getWidth('model') }}>型号</th>
                  {showRetailPrice && <th className={`${tableHeadClass}`} style={{ width: getWidth('retail') }}>零售价</th>}
                  {showDiscountPrice && <th className={`${tableHeadClass} text-left`} style={{ width: getWidth('discount') }}>优惠价</th>}
                  <th className={`${tableHeadClass}`} style={{ width: getWidth('features') }}>功能详述</th>
                  <th className={`${tableHeadClass}`} style={{ width: getWidth('quantity') }}>数量</th>
                  <th className={`${tableHeadClass} rounded-tr-lg`} style={{ width: getWidth('image') }}>图片</th>
               </tr>
            </thead>
            <tbody>
               {cart.map((item, index) => {
                 const currentPrice = item.overridePrice !== undefined ? item.overridePrice : item.price_retail;
                 return (
                   <tr key={item.id} className={`${isModern && index % 2 === 0 ? 'bg-slate-50' : ''}`}>
                      <td className={`${tableCellClass} font-bold pl-2`}>
                        <div className="leading-snug">{item.name}</div>
                      </td>
                      <td className={`${tableCellClass} text-xs font-mono`}>{item.model}</td>
                      {showRetailPrice && (
                      <td className={`${tableCellClass} text-center`}>
                        <div className="relative inline-block">
                           <span className="text-xs relative z-10">{formatPrice(item.price_retail)}</span>
                        </div>
                      </td>
                      )}
                      {showDiscountPrice && (
                      <td className={`${tableCellClass} text-left`}>
                         {!isExportingOrPreview ? (
                            <input 
                              type="number" 
                              className={`w-full max-w-full p-0 text-left text-sm font-bold bg-transparent outline-none leading-normal 
                                ${isNoir ? 'focus:bg-[#2a2a2a]' : 'focus:bg-white focus:text-black'}
                              `}
                              style={{ color: themeColor }}
                              value={currentPrice}
                              onChange={(e) => updateCartItemPrice(item.id, e.target.value)}
                            />
                         ) : (
                            <span className="font-bold text-base block py-1" style={{ color: themeColor }}>{formatPrice(currentPrice)}</span>
                         )}
                      </td>
                      )}
                      <td className={`${tableCellClass}`}>
                         <div className={`text-[10px] leading-relaxed text-justify`}>
                           {item.features?.replace(/\n/g, ' ')}
                         </div>
                      </td>
                      <td className={`${tableCellClass} text-center font-medium`}>{item.quantity}</td>
                      <td className={`${tableCellClass}`}>
                         <div className={`w-20 h-20 mx-auto bg-white rounded border flex items-center justify-center p-1 overflow-hidden ${isNoir ? 'border-gray-800' : 'border-gray-100'}`}>
                            {item.image ? <img src={item.image} className="max-w-full max-h-full" /> : <span className="text-[10px] text-gray-300">无图</span>}
                         </div>
                      </td>
                   </tr>
                 );
               })}
            </tbody>
         </table>

         {/* Total */}
         <div className="preview-total flex justify-end mt-6 mb-6">
            <div className="text-right">
               <div className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${subTextColor}`}>TOTAL AMOUNT</div>
               <div className={`text-4xl font-bold tracking-tighter`} style={accentColorObj}>{formatPrice(cartTotal)}</div>
            </div>
         </div>
      </div>

      {/* 4. Footer */}
      <div className={`preview-footer mt-auto px-4 md:px-8 pb-6 pt-5 border-t ${borderColorClass} ${isNoir ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
         <div className="flex justify-between items-center">
            <div className="max-w-[70%]">
               <h4 className={`font-bold mb-2 text-xs ${isNoir ? 'text-white' : 'text-slate-900'} uppercase tracking-wider`}>Service & Support</h4>
               <div className={`grid grid-cols-2 gap-x-6 gap-y-1 text-[10px] font-medium ${subTextColor}`}>
                  <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-current opacity-50"></span>免费上门设计与3D效果图</div>
                  <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-current opacity-50"></span>烟管预埋及整改方案</div>
                  <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-current opacity-50"></span>橱柜对接与嵌入式安装指导</div>
                  <div className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-current opacity-50"></span>1对1管家式顾问服务</div>
               </div>
            </div>
            {qrCode && (
               <div className={`bg-white rounded flex items-center justify-center overflow-hidden flex-shrink-0`}>
                  <img src={qrCode} className="w-auto h-auto max-h-32 object-contain" />
               </div>
            )}
         </div>
      </div>
      <div className={`preview-bottom-bar ${isNoir ? 'bg-white text-black' : 'text-white'} text-center py-2 text-[8px] font-bold uppercase tracking-[0.3em]`} style={!isNoir ? { backgroundColor: themeColor } : {}}>
         Siemens Home Appliances
      </div>
    </div>
  );
};

export default App;
