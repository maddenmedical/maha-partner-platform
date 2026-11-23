"""Local-only synthetic freedesktop notification service in a private D-Bus session."""
import sys
import dbus, dbus.service, dbus.mainloop.glib
from gi.repository import GLib
iface='org.freedesktop.Notifications'
dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus=dbus.SessionBus()
if len(sys.argv)>1:
    remote=bus.get_object(iface,'/org/freedesktop/Notifications')
    print(remote.TestAction(sys.argv[1],dbus_interface=iface));sys.exit()
class Desktop(dbus.service.Object):
    def __init__(self):
        self.items={};self.n=0
        super().__init__(dbus.service.BusName(iface,bus),'/org/freedesktop/Notifications')
    @dbus.service.method(iface,in_signature='',out_signature='as')
    def GetCapabilities(self):return ['actions','body','persistence','body-markup']
    @dbus.service.method(iface,in_signature='',out_signature='ssss')
    def GetServerInformation(self):return ('Isolated fixture','MAHA QA','1.0','1.2')
    @dbus.service.method(iface,in_signature='susssasa{sv}i',out_signature='u')
    def Notify(self,app,replace,icon,title,body,actions,hints,timeout):
        self.n+=1;i=int(replace) or self.n;self.items[i]=(str(title),list(actions));return dbus.UInt32(i)
    @dbus.service.method(iface,in_signature='u',out_signature='')
    def CloseNotification(self,n):
        if int(n) in self.items:del self.items[int(n)];self.NotificationClosed(n,3)
    @dbus.service.signal(iface,signature='uu')
    def NotificationClosed(self,n,why):pass
    @dbus.service.signal(iface,signature='us')
    def ActionInvoked(self,n,action):pass
    @dbus.service.method(iface,in_signature='s',out_signature='s')
    def TestAction(self,title):
        for n,(s,a) in self.items.items():
            if title==s:
                self.ActionInvoked(dbus.UInt32(n),'default');return 'clicked'
        return 'waiting'
d=Desktop();GLib.MainLoop().run()
