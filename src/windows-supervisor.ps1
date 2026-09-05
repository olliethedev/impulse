$ErrorActionPreference = 'Stop'
$d = Get-Content -Raw -LiteralPath $descriptorFile | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class ImpulseJob {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO {
    public uint cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xCount,yCount,fill,flags;
    public ushort show,reservedSize; public IntPtr reservedBytes,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESSINFO { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] public struct ACCOUNTING {
    public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated;
  }
  [StructLayout(LayoutKind.Sequential)] public struct LIMITS {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeLimit;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong read,write,other,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] public struct EXTENDED { public LIMITS basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,System.Text.StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFO startup,out PROCESSINFO info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out ACCOUNTING accounting,uint length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED limits,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint time);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint kind,uint group);
  IntPtr job; PROCESSINFO process;
  public ImpulseJob(string command,string cwd) {
    job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
    EXTENDED limits=new EXTENDED(); limits.basic.flags=0x2000;
    if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) { CloseHandle(job); throw new Win32Exception(); }
    STARTUPINFO startup=new STARTUPINFO(); startup.cb=(uint)Marshal.SizeOf(startup); startup.flags=0x100;
    startup.stdin=GetStdHandle(-10); startup.stdout=GetStdHandle(-11); startup.stderr=GetStdHandle(-12);
    // Suspend before assignment so no descendant can escape the job during startup.
    if(!CreateProcess(null,new System.Text.StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x204,IntPtr.Zero,cwd,ref startup,out process)) { CloseHandle(job); throw new Win32Exception(); }
    if(!AssignProcessToJobObject(job,process.process)) { int error=Marshal.GetLastWin32Error(); TerminateProcess(process.process,1); Close(); throw new Win32Exception(error); }
    if(ResumeThread(process.thread)==0xffffffff) { TerminateJobObject(job,1); Close(); throw new Win32Exception(); }
  }
  public bool Active() {
    ACCOUNTING accounting; if(!QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)) throw new Win32Exception();
    return accounting.active>0;
  }
  public void Stop(bool force) {
    if(force) { if(!TerminateJobObject(job,1)) throw new Win32Exception(); }
    else if(!GenerateConsoleCtrlEvent(1,process.pid)) throw new Win32Exception();
  }
  public uint ExitCode() { uint code; WaitForSingleObject(process.process,0xffffffff); if(!GetExitCodeProcess(process.process,out code)) throw new Win32Exception(); return code; }
  public void Close() { if(process.thread!=IntPtr.Zero) CloseHandle(process.thread); if(process.process!=IntPtr.Zero) CloseHandle(process.process); if(job!=IntPtr.Zero) CloseHandle(job); }
}
'@
try { $job = [ImpulseJob]::new($d.command_line, $d.cwd) }
catch {
  @{ launch_error = $_.Exception.Message; exit_code = $null } | ConvertTo-Json | Set-Content -LiteralPath $d.outcome_file -Encoding UTF8
  exit 1
}
$sentGrace = $false
$sentForce = $false
try {
  while ($job.Active()) {
    if (Test-Path -LiteralPath $d.control_file) {
      try {
        $control = Get-Content -Raw -LiteralPath $d.control_file | ConvertFrom-Json
        if (!$sentGrace -or ($control.force -and !$sentForce)) {
          $job.Stop([bool]$control.force)
          $sentGrace = $true
          if ($control.force) { $sentForce = $true }
        }
      } catch { [Console]::Error.WriteLine("Impulse cancellation: " + $_.Exception.Message) }
    }
    Start-Sleep -Milliseconds 100
  }
  $code = $job.ExitCode()
  @{ exit_code = $code } | ConvertTo-Json | Set-Content -LiteralPath $d.outcome_file -Encoding UTF8
} finally { $job.Close() }
exit $code
