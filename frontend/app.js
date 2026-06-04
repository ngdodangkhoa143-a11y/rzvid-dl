import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Video, Music, Download, AlertCircle, CheckCircle, Info, 
    ArrowRight, RefreshCw, Clipboard, Check, X, Sparkles, 
    Clock, HelpCircle, ArrowLeft, ShieldCheck, Flame, Zap
} from 'lucide-react';

function App() {
    const [url, setUrl] = useState('');
    const [status, setStatus] = useState('idle'); // idle, analyzing, details, downloading, merging, completed, failed
    const [videoData, setVideoData] = useState(null);
    const [taskId, setTaskId] = useState(null);
    const [progress, setProgress] = useState(0);
    const [downloadSpeed, setDownloadSpeed] = useState('-- KB/s');
    const [downloadEta, setDownloadEta] = useState('-- giây');
    const [filename, setFilename] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [toasts, setToasts] = useState([]);
    const [activeTab, setActiveTab] = useState('home'); // 'home', 'donate'

    const handleNavClick = (targetId) => {
        setActiveTab('home');
        setTimeout(() => {
            const el = document.getElementById(targetId);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };
    
    const progressInterval = useRef(null);
    const urlInputRef = useRef(null);

    // Toast helpers
    const addToast = (message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    // Format duration to MM:SS or HH:MM:SS
    const formatDuration = (seconds) => {
        if (!seconds) return '00:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Handle clipboard paste
    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                setUrl(text.trim());
                addToast('Đã dán liên kết từ bộ nhớ tạm!', 'success');
            } else {
                addToast('Bộ nhớ tạm rỗng!', 'error');
            }
        } catch (err) {
            addToast('Không thể đọc bộ nhớ tạm. Hãy tự dán thủ công.', 'error');
            console.error('Failed to read clipboard:', err);
        }
    };

    // Analyze input URL
    const handleAnalyze = async () => {
        if (!url.trim()) {
            addToast('Vui lòng nhập đường dẫn video!', 'error');
            return;
        }

        setStatus('analyzing');
        setErrorMsg('');
        setVideoData(null);

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim() })
            });

            if (!response.ok) {
                let msg = `Lỗi máy chủ hoặc link không hỗ trợ (HTTP ${response.status})`;
                try {
                    const data = await response.json();
                    if (data && data.detail) msg = data.detail;
                } catch (e) {}
                throw new Error(msg);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Không lấy được thông tin video.');
            }

            setVideoData(data);
            setStatus('details');
        } catch (err) {
            addToast(err.message, 'error');
            setErrorMsg(err.message);
            setStatus('failed');
        }
    };

    // Initiate video/audio download
    const handleDownload = async (optionId) => {
        setStatus('downloading');
        setProgress(0);
        setDownloadSpeed('-- KB/s');
        setDownloadEta('-- giây');

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url.trim(),
                    option_id: optionId
                })
            });

            if (!response.ok) {
                let msg = `Lỗi khởi tạo tải xuống (HTTP ${response.status})`;
                try {
                    const data = await response.json();
                    if (data && data.detail) msg = data.detail;
                } catch (e) {}
                throw new Error(msg);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Không thể khởi chạy tác vụ tải.');
            }

            setTaskId(data.task_id);
            addToast('Bắt đầu tải về máy chủ...', 'success');
            startPolling(data.task_id);

        } catch (err) {
            addToast(err.message, 'error');
            setStatus('details'); // Recover to options panel
        }
    };

    // Poll server task status
    const startPolling = (taskIdentifier) => {
        if (progressInterval.current) clearInterval(progressInterval.current);

        progressInterval.current = setInterval(async () => {
            try {
                const response = await fetch(`/api/progress/${taskIdentifier}`);
                if (!response.ok) throw new Error('Không thể đồng bộ tiến trình với máy chủ.');

                const task = await response.json();

                if (task.status === 'downloading' || task.status === 'merging') {
                    setProgress(task.progress || 0);
                    setDownloadSpeed(task.speed || '-- KB/s');
                    setDownloadEta(task.eta || '-- giây');
                    if (task.status === 'merging') {
                        setStatus('merging');
                    }
                } 
                else if (task.status === 'completed') {
                    clearInterval(progressInterval.current);
                    setProgress(100);
                    setFilename(task.filename);
                    setStatus('completed');
                    addToast('Tải video thành công!', 'success');

                    // Trigger direct browser download stream
                    const retrieveUrl = `/api/retrieve/${taskIdentifier}`;
                    const a = document.createElement('a');
                    a.href = retrieveUrl;
                    a.download = task.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                } 
                else if (task.status === 'failed') {
                    clearInterval(progressInterval.current);
                    addToast(task.error || 'Tải video thất bại.', 'error');
                    setErrorMsg(task.error || 'Đã xảy ra lỗi không xác định.');
                    setStatus('failed');
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 500);
    };

    // Cancel current download task
    const handleCancel = () => {
        if (progressInterval.current) clearInterval(progressInterval.current);
        addToast('Đã hủy tiến trình tải.', 'error');
        setStatus('details');
    };

    // Reset back to empty state
    const handleReset = () => {
        setUrl('');
        setStatus('idle');
        setVideoData(null);
        setErrorMsg('');
        if (urlInputRef.current) urlInputRef.current.focus();
    };

    // Clean up polling interval on unmount
    useEffect(() => {
        return () => {
            if (progressInterval.current) clearInterval(progressInterval.current);
        };
    }, []);

    // Get extractor styles and badges
    const getPlatformBadge = (extractor) => {
        const isTikTok = extractor.includes('tiktok');
        const isYoutube = extractor.includes('youtube');
        const isFacebook = extractor.includes('facebook');
        const isInstagram = extractor.includes('instagram');
        
        let colorClass = 'bg-slate-900/60 border-slate-800 text-slate-400';
        let name = extractor;

        if (isTikTok) {
            colorClass = 'bg-rose-500/10 border-rose-500/20 text-rose-400';
            name = 'TikTok';
        } else if (isYoutube) {
            colorClass = 'bg-red-500/10 border-red-500/20 text-red-400';
            name = 'YouTube';
        } else if (isFacebook) {
            colorClass = 'bg-blue-500/10 border-blue-500/20 text-blue-400';
            name = 'Facebook';
        } else if (isInstagram) {
            colorClass = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
            name = 'Instagram';
        }

        return (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-2xs font-bold border ${colorClass} uppercase tracking-wider select-none`}>
                <Flame className="w-3 h-3" />
                {name}
            </span>
        );
    };

    return (
        <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col min-h-screen gap-8 md:gap-14">
            
            {/* 1. Header component */}
            <header className="flex items-center justify-between select-none">
                <motion.div 
                    className="flex items-center gap-3 group cursor-pointer"
                    whileHover={{ scale: 1.02 }}
                    onClick={() => setActiveTab('home')}
                >
                    <div className="w-9 h-9 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/10">
                        <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}>
                            <Sparkles className="w-4 h-4 text-white" />
                        </motion.div>
                    </div>
                    <span className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">RzVid</span>
                </motion.div>
                
                <nav className="hidden md:flex items-center gap-8 text-2xs font-bold uppercase tracking-widest text-slate-400">
                    <button 
                        onClick={() => setActiveTab('home')} 
                        className={`hover:text-white transition-colors uppercase ${activeTab === 'home' ? 'text-slate-100 font-extrabold' : 'text-slate-450'}`}
                    >
                        Trang chủ
                    </button>
                    <button 
                        onClick={() => handleNavClick('features')} 
                        className="hover:text-slate-200 transition-colors uppercase"
                    >
                        Tính năng
                    </button>
                    <button 
                        onClick={() => handleNavClick('platforms')} 
                        className="hover:text-slate-200 transition-colors uppercase"
                    >
                        Nền tảng
                    </button>
                    <button 
                        onClick={() => setActiveTab('donate')} 
                        className={`flex items-center gap-1.5 hover:text-indigo-355 transition-all font-bold uppercase tracking-widest ${activeTab === 'donate' ? 'text-indigo-400 font-extrabold' : 'text-slate-450'}`}
                    >
                        <span>Donate</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    </button>
                </nav>

                <div className="flex items-center gap-2.5">
                    <motion.button 
                        onClick={() => setActiveTab('donate')}
                        whileHover={{ scale: 1.03 }} 
                        whileTap={{ scale: 0.97 }}
                        className={`text-3xs font-extrabold uppercase tracking-widest px-3.5 py-2 border rounded-xl transition-all block text-white shadow-lg ${activeTab === 'donate' ? 'bg-indigo-650 border-indigo-400 shadow-indigo-500/20' : 'bg-indigo-650 hover:bg-indigo-600 border-indigo-550 shadow-indigo-500/10'}`}
                    >
                        Donate 💖
                    </motion.button>
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="hidden sm:block">
                        <a href="#features" onClick={() => handleNavClick('features')} className="text-3xs font-bold uppercase tracking-widest px-3 py-1.5 bg-white/5 border border-white/8 hover:bg-white/10 rounded-xl transition-all block text-slate-355 hover:text-white">
                            SaaS v2.0
                        </a>
                    </motion.div>
                </div>
            </header>

            {/* 2. Main content area with AnimatePresence tab switching */}
            <AnimatePresence mode="wait">
                {activeTab === 'home' ? (
                    <motion.div
                        key="home-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="w-full flex flex-col items-center gap-8 md:gap-12 flex-grow"
                    >
                        <main className="flex flex-col items-center justify-center gap-8 md:gap-12 w-full">
                            
                            {/* Hero Header */}
                            <motion.section 
                                className="text-center max-w-3xl flex flex-col items-center gap-4"
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                            >
                                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/15 text-indigo-400 text-2xs font-bold uppercase tracking-wider select-none mb-1 shadow-sm">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                                    Đầu thế giới về tải video không logo
                                </div>
                                <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
                                    Tải Video & Audio<br />
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400">
                                        Chất Lượng Gốc
                                    </span>
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-400 max-w-xl leading-relaxed">
                                    Trích xuất tệp video chất lượng cao từ TikTok, YouTube, Facebook, Instagram không dính logo watermark hoàn toàn miễn phí.
                                </p>
                            </motion.section>

                            {/* Input Search Panel */}
                            <motion.section 
                                className="w-full max-w-3xl flex flex-col gap-4"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.1 }}
                            >
                                <div className="glass-input rounded-2xl p-1.5 flex flex-col sm:flex-row items-center gap-2 transition-all duration-300">
                                    <div className="flex items-center w-full pl-3 gap-2">
                                        <Video className="w-5 h-5 text-slate-500 shrink-0" />
                                        <input 
                                            ref={urlInputRef}
                                            type="text" 
                                            value={url}
                                            onChange={(e) => setUrl(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                                            disabled={status === 'analyzing' || status === 'downloading' || status === 'merging'}
                                            className="w-full bg-transparent border-none outline-none py-2.5 text-slate-100 placeholder-slate-500 text-sm focus:ring-0 focus:outline-none" 
                                            placeholder="Dán đường dẫn video hoặc âm thanh vào đây..." 
                                            autoComplete="off" 
                                        />
                                        
                                        {status === 'idle' && (
                                            <motion.button 
                                                onClick={handlePaste}
                                                whileHover={{ scale: 1.03 }}
                                                whileTap={{ scale: 0.97 }}
                                                className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/8 rounded-xl text-slate-350 hover:text-white transition-all shrink-0"
                                            >
                                                <Clipboard className="w-3.5 h-3.5" />
                                                Dán Link
                                            </motion.button>
                                        )}
                                    </div>
                                    
                                    <motion.button 
                                        onClick={handleAnalyze}
                                        disabled={status === 'analyzing' || status === 'downloading' || status === 'merging'}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="w-full sm:w-auto font-bold text-sm px-6 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white rounded-xl shadow-lg shadow-indigo-500/10 shrink-0 flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {status === 'analyzing' ? (
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <span>Phân Tích</span>
                                                <ArrowRight className="w-4 h-4" />
                                            </>
                                        )}
                                    </motion.button>
                                </div>

                                {/* Supported Platforms Banner */}
                                <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 text-2xs text-slate-500 mt-2 select-none" id="platforms">
                                    <span className="font-semibold text-slate-600 uppercase tracking-widest text-[9px]">Hỗ trợ:</span>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.02] border border-white/5 rounded-full hover:text-rose-500 hover:border-rose-500/20 transition-all cursor-default">
                                        <span className="w-1 h-1 rounded-full bg-rose-500"></span>
                                        <span>TikTok</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.02] border border-white/5 rounded-full hover:text-red-500 hover:border-red-500/20 transition-all cursor-default">
                                        <span className="w-1 h-1 rounded-full bg-red-500"></span>
                                        <span>YouTube</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.02] border border-white/5 rounded-full hover:text-blue-500 hover:border-blue-500/20 transition-all cursor-default">
                                        <span className="w-1 h-1 rounded-full bg-blue-500"></span>
                                        <span>Facebook</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.02] border border-white/5 rounded-full hover:text-amber-500 hover:border-amber-500/20 transition-all cursor-default">
                                        <span className="w-1 h-1 rounded-full bg-amber-500"></span>
                                        <span>Instagram</span>
                                    </div>
                                </div>
                            </motion.section>

                            {/* Dynamic UI Workspace Panels */}
                            <section className="w-full max-w-3xl min-h-[160px] relative">
                                <AnimatePresence mode="wait">
                                    
                                    {/* 2A. Idle Empty State Panel */}
                                    {status === 'idle' && (
                                        <motion.div 
                                            key="idle-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            transition={{ type: 'spring', duration: 0.5 }}
                                            className="glass-panel rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-4 relative overflow-hidden group cinematic-glow"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
                                            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform duration-300">
                                                <Info className="w-5 h-5" />
                                            </div>
                                            <div className="max-w-md">
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Sẵn sàng phân tích</h3>
                                                <p className="text-2xs sm:text-xs text-slate-400 mt-2 leading-relaxed">
                                                    Dán liên kết video từ các nền tảng vào thanh tìm kiếm phía trên để bắt đầu phân tích định dạng và độ phân giải.
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* 2B. Analyzing / Loading State Panel */}
                                    {status === 'analyzing' && (
                                        <motion.div 
                                            key="analyzing-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            className="glass-panel rounded-2xl p-10 md:p-14 text-center flex flex-col items-center justify-center gap-5 relative overflow-hidden cinematic-glow"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
                                            <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                                            <div className="flex flex-col gap-1.5 mt-2">
                                                <div className="text-xs font-bold text-slate-250 uppercase tracking-widest">Đang tải cấu trúc dữ liệu...</div>
                                                <div className="text-3xs text-slate-500 uppercase tracking-wider font-semibold">Công cụ đang vượt tường lửa của CDN bảo mật</div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* 2C. Detail and Download Formats Selection Panel */}
                                    {status === 'details' && videoData && (
                                        <motion.div 
                                            key="details-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            className="glass-panel rounded-2xl p-5 sm:p-7 flex flex-col gap-6 relative overflow-hidden cinematic-glow"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
                                            
                                            <div className="flex flex-col md:flex-row gap-5">
                                                <div className="relative w-full md:w-56 h-32 rounded-xl overflow-hidden border border-white/5 shrink-0 shadow-inner group">
                                                    <img 
                                                        src={videoData.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=400&q=80'} 
                                                        alt="Thumbnail" 
                                                        className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500" 
                                                        onError={(e) => {
                                                            e.target.src = 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=400&q=80';
                                                        }}
                                                    />
                                                    <span className="absolute bottom-2 right-2 bg-slate-950/80 backdrop-blur-xs text-white px-2 py-0.5 rounded text-3xs font-bold tracking-wider select-none">
                                                        {formatDuration(videoData.duration)}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col justify-between py-1">
                                                    <div className="flex flex-col gap-3">
                                                        {getPlatformBadge(videoData.extractor)}
                                                        <h2 className="text-sm font-bold text-slate-100 leading-snug line-clamp-2">{videoData.title}</h2>
                                                    </div>
                                                    <button 
                                                        onClick={handleReset}
                                                        className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-200 transition-colors w-fit mt-3 select-none"
                                                    >
                                                        <ArrowLeft className="w-3.5 h-3.5" />
                                                        Quay lại nhập link
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            <div className="border-t border-white/5 pt-5 flex flex-col gap-4">
                                                <h3 className="text-3xs font-extrabold text-slate-400 tracking-widest uppercase select-none">Tùy chọn tải về không dính logo</h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    {videoData.options.map((opt) => {
                                                        const isAudio = opt.type === 'audio';
                                                        const sizeBadgeColor = isAudio ? 'bg-amber-500/10 border-amber-500/15 text-amber-400' : 'bg-indigo-500/10 border-indigo-500/15 text-indigo-400';
                                                        
                                                        return (
                                                            <motion.button 
                                                                key={opt.id}
                                                                onClick={() => handleDownload(opt.id)}
                                                                whileHover={{ scale: 1.01 }}
                                                                whileTap={{ scale: 0.99 }}
                                                                className="w-full text-left bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-indigo-500/30 p-3 rounded-xl flex items-center justify-between group transition-all duration-200"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`w-8 h-8 rounded-lg ${sizeBadgeColor} border flex items-center justify-center shrink-0`}>
                                                                        {isAudio ? <Music className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                                                                    </div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-xs font-bold text-slate-250 group-hover:text-white transition-colors">{opt.label}</span>
                                                                        <span className="text-[10px] text-slate-550 uppercase tracking-wider font-bold mt-0.5">
                                                                            {isAudio ? 'MP3 Audio • 320kbps' : `${opt.resolution}p MP4 • Không logo`}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/5 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-500 flex items-center justify-center text-slate-400 transition-all duration-200 shrink-0">
                                                                    <Download className="w-3.5 h-3.5" />
                                                                </div>
                                                            </motion.button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* 2D. Active Downloading Progress Panel */}
                                    {(status === 'downloading' || status === 'merging') && (
                                        <motion.div 
                                            key="progress-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden cinematic-glow"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
                                            <h3 className="text-3xs font-extrabold text-slate-350 tracking-widest uppercase select-none">Khởi tạo tải xuống</h3>
                                            <div className="flex items-center justify-between">
                                                <span id="progress-status" className="text-2xs font-bold uppercase tracking-wider text-slate-400">
                                                    {status === 'downloading' ? 'Đang tải về máy chủ...' : 'Đang ghép luồng video & âm thanh...'}
                                                </span>
                                                <span id="progress-percent" className="text-sm font-bold text-indigo-400">{progress}%</span>
                                            </div>
                                            
                                            {/* Progress Bar wrapper */}
                                            <div className="w-full h-1.5 bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                                                <motion.div 
                                                    id="progress-fill" 
                                                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full shadow-lg shadow-indigo-500/20"
                                                    animate={{ width: `${progress}%` }}
                                                    transition={{ duration: 0.3, ease: 'easeOut' }}
                                                />
                                            </div>
                                            
                                            {/* Statistics Grid */}
                                            <div className="grid grid-cols-2 gap-4 bg-white/[0.01] border border-white/5 p-4 rounded-xl select-none">
                                                <div className="flex flex-col items-center justify-center gap-1 border-r border-white/5">
                                                    <span className="text-3xs text-slate-500 uppercase tracking-wider font-bold">Tốc độ tải</span>
                                                    <span id="download-speed" className="text-xs font-bold text-slate-200">{downloadSpeed}</span>
                                                </div>
                                                <div className="flex flex-col items-center justify-center gap-1">
                                                    <span className="text-3xs text-slate-500 uppercase tracking-wider font-bold">Còn lại</span>
                                                    <span id="download-eta" className="text-xs font-bold text-slate-200">{downloadEta}</span>
                                                </div>
                                            </div>
                                            
                                            <motion.button 
                                                onClick={handleCancel}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                className="self-center text-3xs font-extrabold uppercase tracking-widest px-4 py-2.5 bg-white/5 border border-white/8 hover:bg-white/10 text-slate-350 hover:text-white rounded-xl transition-all"
                                            >
                                                Hủy Tải
                                            </motion.button>
                                        </motion.div>
                                    )}

                                    {/* 2E. Success Completed State Panel */}
                                    {status === 'completed' && (
                                        <motion.div 
                                            key="completed-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            className="glass-panel rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-5 relative overflow-hidden cinematic-glow-green"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent"></div>
                                            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-inner">
                                                <CheckCircle className="w-8 h-8" />
                                            </div>
                                            <div className="max-w-md">
                                                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-100">Tải Xuống Hoàn Tất!</h3>
                                                <p className="text-2xs text-slate-400 mt-2 leading-relaxed">Trình duyệt đã tự động tải tệp tin về máy của bạn thành công.</p>
                                            </div>
                                            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-2 w-full sm:w-auto select-none">
                                                <motion.button 
                                                    onClick={() => setStatus('details')}
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    className="text-3xs font-bold uppercase tracking-widest px-5 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white rounded-xl shadow-lg shadow-indigo-500/15 w-full sm:w-auto"
                                                >
                                                    Tải chất lượng khác
                                                </motion.button>
                                                <motion.button 
                                                    onClick={handleReset}
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    className="text-3xs font-bold uppercase tracking-widest px-5 py-3.5 bg-white/5 border border-white/8 hover:bg-white/10 text-slate-350 hover:text-white rounded-xl w-full sm:w-auto"
                                                >
                                                    Tải video mới
                                                </motion.button>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* 2F. Error Failed State Panel */}
                                    {status === 'failed' && (
                                        <motion.div 
                                            key="failed-panel"
                                            initial={{ opacity: 0, scale: 0.98, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98, y: -15 }}
                                            className="glass-panel border-rose-500/20 rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-4 relative overflow-hidden cinematic-glow-red"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-rose-500/20 to-transparent"></div>
                                            <div className="w-11 h-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shadow-inner">
                                                <AlertCircle className="w-5.5 h-5.5" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Không Thể Phân Tích Đường Dẫn</h3>
                                                <p className="text-2xs text-slate-450 max-w-md leading-relaxed mx-auto mt-1">{errorMsg}</p>
                                            </div>
                                            <motion.button 
                                                onClick={videoData ? () => setStatus('details') : handleReset}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                className="mt-2 text-3xs font-bold uppercase tracking-widest px-4 py-2.5 bg-white/5 border border-white/8 rounded-xl text-slate-350 hover:text-white transition-all active:scale-[0.98]"
                                            >
                                                {videoData ? 'Quay lại' : 'Thử Lại'}
                                            </motion.button>
                                        </motion.div>
                                    )}

                                </AnimatePresence>
                            </section>
                        </main>

                        {/* 3. Features Cards Grid */}
                        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full mt-4 select-none" id="features">
                            <motion.div 
                                className="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:border-indigo-500/25 transition-colors duration-300 group cursor-pointer"
                                whileHover={{ y: -4 }}
                            >
                                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 transition-colors shrink-0">
                                    <ShieldCheck className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Tải Không Logo</h3>
                                    <p className="text-[11px] text-slate-450 leading-relaxed mt-1">Hệ thống phân tích tự động giải quyết các thẻ DRM và watermark từ máy chủ TikTok.</p>
                                </div>
                            </motion.div>

                            <motion.div 
                                className="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:border-indigo-500/25 transition-colors duration-300 group cursor-pointer"
                                whileHover={{ y: -4 }}
                            >
                                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 transition-colors shrink-0">
                                    <Music className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Trích xuất Âm thanh</h3>
                                    <p className="text-[11px] text-slate-450 leading-relaxed mt-1">Chuyển đổi luồng audio thành tệp MP3 chất lượng cao để nghe offline hoặc cài đặt nhạc chuông.</p>
                                </div>
                            </motion.div>

                            <motion.div 
                                className="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:border-indigo-500/25 transition-colors duration-300 group cursor-pointer"
                                whileHover={{ y: -4 }}
                            >
                                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 transition-colors shrink-0">
                                    <Zap className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Hiệu Năng Vượt Trội</h3>
                                    <p className="text-[11px] text-slate-450 leading-relaxed mt-1">Tải xuống đa luồng thông qua bộ phân giải thông minh giúp tốc độ truyền tải cực kỳ nhanh chóng.</p>
                                </div>
                            </motion.div>
                        </section>
                    </motion.div>
                ) : (
                    <motion.div
                        key="donate-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="w-full flex flex-col items-center gap-8 md:gap-10 flex-grow py-4"
                    >
                        {/* Donate Header */}
                        <div className="text-center max-w-3xl flex flex-col items-center gap-4">
                            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/15 text-indigo-400 text-2xs font-bold uppercase tracking-wider select-none mb-1 shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                                Ủng hộ dự án & nhà phát triển
                            </div>
                            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
                                Đồng Hành Cùng <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">RzVid</span>
                            </h2>
                            <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                                Đóng góp của bạn giúp duy trì máy chủ tải video tốc độ cao miễn phí và động viên tôi phát triển nhiều công cụ hữu ích hơn.
                            </p>
                        </div>

                        {/* Donate Main Card Grid */}
                        <div className="glass-panel rounded-2xl p-6 sm:p-8 max-w-3xl w-full flex flex-col md:flex-row gap-8 items-center relative overflow-hidden cinematic-glow select-none">
                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
                            
                            {/* QR Code Column */}
                            <div className="flex flex-col items-center gap-3 shrink-0">
                                <motion.div 
                                    className="bg-white p-3 rounded-2xl border border-white/10 shadow-2xl relative group overflow-hidden"
                                    whileHover={{ scale: 1.02 }}
                                >
                                    <img 
                                        src="donate-qr.jpg" 
                                        alt="VietinBank QR Code" 
                                        className="w-52 h-auto object-contain rounded-xl select-none" 
                                        draggable="false"
                                    />
                                    <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                                </motion.div>
                                <span className="text-[10px] text-slate-550 uppercase tracking-widest font-extrabold">Quét mã để donate</span>
                            </div>
                            
                            {/* Account Details & Contacts Column */}
                            <div className="flex flex-col gap-5 flex-grow w-full">
                                {/* Bank Info Card */}
                                <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl flex flex-col gap-2 relative group hover:border-indigo-500/20 transition-all">
                                    <div className="flex justify-between items-start">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-extrabold">Ngân hàng thụ hưởng</span>
                                            <span className="text-xs font-extrabold text-slate-100">VIETINBANK</span>
                                        </div>
                                        <span className="text-[9.5px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md uppercase tracking-wider">Napas 247</span>
                                    </div>
                                    
                                    <div className="flex flex-col gap-0.5 mt-1">
                                        <span className="text-[9px] text-slate-500 uppercase tracking-widest font-extrabold">Số tài khoản</span>
                                        <div className="flex items-center justify-between gap-2 mt-0.5">
                                            <span className="text-sm font-extrabold text-slate-200 tracking-wider">100883931040</span>
                                            <motion.button 
                                                onClick={() => {
                                                    navigator.clipboard.writeText('100883931040');
                                                    addToast('Đã sao chép số tài khoản: 100883931040!', 'success');
                                                }}
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg transition-all"
                                            >
                                                <Clipboard className="w-3 h-3" />
                                                Sao chép
                                            </motion.button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-col gap-0.5 mt-1 border-t border-white/5 pt-2">
                                        <span className="text-[9px] text-slate-550 uppercase tracking-widest font-bold">Chủ tài khoản</span>
                                        <span className="text-xs font-bold text-slate-300">NGUYEN DO DANG KHOA</span>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-slate-500 uppercase tracking-widest font-extrabold">Chi nhánh</span>
                                        <span className="text-2xs font-semibold text-slate-400">CN BAC DA NANG - HOI SO</span>
                                    </div>
                                </div>
                                
                                {/* Creator Social Links */}
                                <div className="flex flex-col gap-2">
                                    <span className="text-[10px] text-slate-550 uppercase tracking-widest font-bold pl-1">Thông tin liên hệ người tạo</span>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        <a 
                                            href="https://www.facebook.com/ut.1403" 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="flex items-center justify-center gap-2 p-2.5 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-blue-500/30 rounded-xl text-2xs text-slate-300 hover:text-white transition-all group"
                                        >
                                            <svg className="w-3.5 h-3.5 text-blue-500 fill-current" viewBox="0 0 24 24">
                                                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                            </svg>
                                            <span className="font-bold">Facebook</span>
                                        </a>
                                        
                                        <a 
                                            href="mailto:ngdodangkhoa143@gmail.com" 
                                            className="flex items-center justify-center gap-2 p-2.5 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-rose-500/30 rounded-xl text-2xs text-slate-300 hover:text-white transition-all group"
                                        >
                                            <svg className="w-3.5 h-3.5 text-rose-500 fill-none stroke-current" strokeWidth="2.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/>
                                            </svg>
                                            <span className="font-bold">Email</span>
                                        </a>
                                        
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText('dkhoa_102');
                                                addToast('Đã sao chép Discord ID: dkhoa_102!', 'success');
                                            }}
                                            className="flex items-center justify-center gap-2 p-2.5 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-indigo-500/30 rounded-xl text-2xs text-slate-300 hover:text-white transition-all group"
                                        >
                                            <svg className="w-3.5 h-3.5 text-indigo-500 fill-current" viewBox="0 0 24 24">
                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.03c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.03A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.873-.894.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 0 1 .077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009c.12.099.246.195.373.289a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z"/>
                                            </svg>
                                            <span className="font-bold">Discord</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Go Back button */}
                        <motion.button 
                            onClick={() => setActiveTab('home')}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="text-3xs font-extrabold uppercase tracking-widest px-6 py-3 bg-white/5 border border-white/8 hover:bg-white/10 text-slate-355 hover:text-white rounded-xl transition-all"
                        >
                            Quay lại trang chủ
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 4. Footer section */}
            <footer className="border-t border-slate-900 pt-6 pb-2 text-center text-3xs font-semibold uppercase tracking-widest text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
                <div className="flex gap-4">
                    <button onClick={() => handleNavClick('home')} className="hover:text-slate-355 transition-colors uppercase">Tài liệu</button>
                    <span className="text-slate-800">|</span>
                    <button onClick={() => handleNavClick('features')} className="hover:text-slate-355 transition-colors uppercase">Tính năng</button>
                    <span className="text-slate-800">|</span>
                    <button onClick={() => handleNavClick('platforms')} className="hover:text-slate-355 transition-colors uppercase">Nền tảng</button>
                </div>
                <p>&copy; 2026 RzVid Downloader. Thiết kế SaaS tối giản & tối ưu sản xuất.</p>
            </footer>

            {/* 5. Toasts Container with AnimatePresence */}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
                <AnimatePresence>
                    {toasts.map(toast => {
                        const statusColors = toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400';
                        return (
                            <motion.div
                                key={toast.id}
                                initial={{ transform: 'translateX(100%)', opacity: 0 }}
                                animate={{ transform: 'translateX(0)', opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                className="pointer-events-auto glass-panel rounded-xl p-3.5 shadow-2xl flex items-center gap-3 text-2xs font-bold tracking-wide text-slate-200 max-w-sm w-full"
                            >
                                <div className={`w-6 h-6 rounded-lg ${statusColors} border flex items-center justify-center shrink-0`}>
                                    {toast.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                                </div>
                                <div className="leading-normal flex-grow">{toast.message}</div>
                                <button 
                                    onClick={() => removeToast(toast.id)} 
                                    className="text-slate-500 hover:text-slate-350 transition-colors select-none"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </div>
    );
}

// Initialise React DOM
const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
